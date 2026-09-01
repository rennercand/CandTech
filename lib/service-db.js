import { randomUUID } from "node:crypto";
import { getDatabaseBackend } from "./db.js";

let schemaPromise;

async function ensureSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const backend = await getDatabaseBackend();
    if (backend.type === "sqlite") backend.db.exec(`
      CREATE TABLE IF NOT EXISTS service_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, owner_user_id INTEGER NOT NULL,
        organization_id INTEGER NOT NULL, customer_id INTEGER, financial_commitment_id INTEGER, series_public_id TEXT,
        recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','weekly','monthly','yearly')),
        recurrence_index INTEGER NOT NULL DEFAULT 1 CHECK(recurrence_index BETWEEN 1 AND 60),
        recurrence_count INTEGER NOT NULL DEFAULT 1 CHECK(recurrence_count BETWEEN 1 AND 60), quote_number TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', assignee TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
        scheduled_for TEXT, due_on TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('quote','draft','approved','scheduled','in_progress','completed','cancelled')),
        quoted_amount REAL NOT NULL DEFAULT 0, estimated_cost REAL NOT NULL DEFAULT 0, actual_cost REAL NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '', completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(owner_user_id) REFERENCES users(id), FOREIGN KEY(organization_id) REFERENCES organizations(id),
        FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(financial_commitment_id) REFERENCES financial_commitments(id));
      CREATE INDEX IF NOT EXISTS idx_service_orders_organization_schedule ON service_orders(organization_id,status,scheduled_for,id);
      CREATE TABLE IF NOT EXISTS service_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, service_order_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('service','material')),
        description TEXT NOT NULL, inventory_variant_id INTEGER, quantity REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0, unit_cost REAL NOT NULL DEFAULT 0,
        FOREIGN KEY(service_order_id) REFERENCES service_orders(id) ON DELETE CASCADE, FOREIGN KEY(inventory_variant_id) REFERENCES inventory_variants(id));
      CREATE INDEX IF NOT EXISTS idx_service_order_items_order ON service_order_items(service_order_id,id);
    `);
    return backend;
  })();
  return schemaPromise;
}

function organizationId(db, tenantId) {
  return db.prepare("SELECT id FROM organizations WHERE ? = 'organization:' || CAST(id AS TEXT)").get(tenantId)?.id || null;
}

function serialize(row) {
  return { id: row.public_id, customerId: row.customer_public_id || "", quoteNumber: row.quote_number || "", title: row.title,
    description: row.description || "", assignee: row.assignee || "", location: row.location || "",
    scheduledFor: row.scheduled_for ? String(row.scheduled_for) : "", dueOn: row.due_on ? String(row.due_on).slice(0, 10) : "",
    status: row.status, recurrence: row.recurrence, recurrenceIndex: Number(row.recurrence_index), recurrenceCount: Number(row.recurrence_count),
    seriesId: row.series_public_id || "", quotedAmount: Number(row.quoted_amount), estimatedCost: Number(row.estimated_cost),
    actualCost: Number(row.actual_cost), notes: row.notes || "", completedAt: row.completed_at ? String(row.completed_at) : "",
    billed: Boolean(row.financial_commitment_id), items: [] };
}

export async function listServiceOrders(tenantId) {
  const backend = await ensureSchema();
  let orders; let items;
  if (backend.type === "postgres") {
    [orders, items] = await Promise.all([
      backend.sql`SELECT s.*, c.public_id AS customer_public_id FROM service_orders s LEFT JOIN customers c ON c.id=s.customer_id
        WHERE s.organization_id=(SELECT id FROM organizations WHERE ${tenantId}='organization:'||id::text)
        ORDER BY CASE WHEN s.status IN ('completed','cancelled') THEN 1 ELSE 0 END, s.scheduled_for NULLS LAST, s.created_at DESC LIMIT 200`,
      backend.sql`SELECT i.*, s.public_id AS service_public_id, v.public_id AS variant_public_id FROM service_order_items i
        JOIN service_orders s ON s.id=i.service_order_id LEFT JOIN inventory_variants v ON v.id=i.inventory_variant_id
        WHERE s.organization_id=(SELECT id FROM organizations WHERE ${tenantId}='organization:'||id::text) ORDER BY i.id`,
    ]);
  } else {
    const orgId = organizationId(backend.db, tenantId);
    orders = backend.db.prepare(`SELECT s.*, c.public_id AS customer_public_id FROM service_orders s LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.organization_id=? ORDER BY CASE WHEN s.status IN ('completed','cancelled') THEN 1 ELSE 0 END, CASE WHEN s.scheduled_for IS NULL THEN 1 ELSE 0 END, s.scheduled_for, s.created_at DESC LIMIT 200`).all(orgId);
    items = backend.db.prepare(`SELECT i.*, s.public_id AS service_public_id, v.public_id AS variant_public_id FROM service_order_items i
      JOIN service_orders s ON s.id=i.service_order_id LEFT JOIN inventory_variants v ON v.id=i.inventory_variant_id WHERE s.organization_id=? ORDER BY i.id`).all(orgId);
  }
  const result = orders.map(serialize); const byId = new Map(result.map((order) => [order.id, order]));
  for (const item of items) byId.get(String(item.service_public_id))?.items.push({ id: String(item.id), kind: item.kind,
    description: item.description, variantId: item.variant_public_id || "", quantity: Number(item.quantity), unitPrice: Number(item.unit_price), unitCost: Number(item.unit_cost) });
  return result;
}

export async function createServiceOrder({ tenantId, ownerUserId, data }) {
  const backend = await ensureSchema(); const id = randomUUID(); const seriesId = data.recurrence === "none" ? null : randomUUID();
  if (backend.type === "postgres") await backend.sql.transaction((tx) => [
    tx`INSERT INTO service_orders (public_id,owner_user_id,organization_id,customer_id,series_public_id,recurrence,recurrence_count,quote_number,title,description,assignee,location,scheduled_for,due_on,status,quoted_amount,estimated_cost,notes)
      SELECT ${id},${ownerUserId},o.id,c.id,${seriesId},${data.recurrence},${data.recurrenceCount},${data.quoteNumber},${data.title},${data.description},${data.assignee},${data.location},${data.scheduledFor || null},${data.dueOn || null},${data.status},${data.quotedAmount},${data.estimatedCost},${data.notes}
      FROM organizations o LEFT JOIN customers c ON c.organization_id=o.id AND c.public_id=${data.customerId || null} WHERE ${tenantId}='organization:'||o.id::text`,
    ...data.items.map((item) => tx`INSERT INTO service_order_items(service_order_id,kind,description,inventory_variant_id,quantity,unit_price,unit_cost)
      SELECT s.id,${item.kind},${item.description},v.id,${item.quantity},${item.unitPrice},${item.unitCost} FROM service_orders s
      LEFT JOIN inventory_variants v ON v.organization_id=s.organization_id AND v.public_id=${item.variantId || null}
      WHERE s.public_id=${id} AND (${item.kind}='service' OR v.id IS NOT NULL)`),
    tx`SELECT 1/CASE WHEN COUNT(*)=${data.items.length} THEN 1 ELSE 0 END FROM service_order_items WHERE service_order_id=(SELECT id FROM service_orders WHERE public_id=${id})`,
    tx`INSERT INTO outbox_events(public_id,organization_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload)
      SELECT ${randomUUID()},organization_id,'service_order',${id},'service.created',${`service:${id}:created`},${JSON.stringify({ title: data.title })}::jsonb FROM service_orders WHERE public_id=${id}`,
  ], { isolationLevel: "Serializable" });
  else {
    const db=backend.db, orgId=organizationId(db,tenantId); db.exec("BEGIN IMMEDIATE");
    try { const customer=data.customerId?db.prepare("SELECT id FROM customers WHERE organization_id IS ? AND public_id=?").get(orgId,data.customerId):null;
      const order=db.prepare(`INSERT INTO service_orders(public_id,owner_user_id,organization_id,customer_id,series_public_id,recurrence,recurrence_count,quote_number,title,description,assignee,location,scheduled_for,due_on,status,quoted_amount,estimated_cost,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,ownerUserId,orgId,customer?.id||null,seriesId,data.recurrence,data.recurrenceCount,data.quoteNumber,data.title,data.description,data.assignee,data.location,data.scheduledFor||null,data.dueOn||null,data.status,data.quotedAmount,data.estimatedCost,data.notes);
      const insert=db.prepare(`INSERT INTO service_order_items(service_order_id,kind,description,inventory_variant_id,quantity,unit_price,unit_cost) VALUES(?,?,?,?,?,?,?)`);
      for(const item of data.items){const variant=item.variantId?db.prepare("SELECT id FROM inventory_variants WHERE organization_id IS ? AND public_id=?").get(orgId,item.variantId):null;if(item.kind==="material"&&!variant)throw new Error("INVALID_SERVICE_MATERIAL");insert.run(order.lastInsertRowid,item.kind,item.description,variant?.id||null,item.quantity,item.unitPrice,item.unitCost);}
      db.prepare(`INSERT INTO outbox_events(public_id,organization_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload) VALUES(?,?,'service_order',?,'service.created',?,?)`).run(randomUUID(),orgId,id,`service:${id}:created`,JSON.stringify({title:data.title})); db.exec("COMMIT");
    } catch(error){db.exec("ROLLBACK");throw error;}
  }
  return { id };
}

function nextDate(value, recurrence) {
  if (!value || recurrence === "none") return null; const date=new Date(value); if(!Number.isFinite(date.getTime())) return null;
  if(recurrence==="weekly") date.setUTCDate(date.getUTCDate()+7); else if(recurrence==="monthly") date.setUTCMonth(date.getUTCMonth()+1); else date.setUTCFullYear(date.getUTCFullYear()+1); return date.toISOString();
}

async function serviceMaterialLines(backend, tenantId, serviceId) {
  const orgId=backend.type==="sqlite"?organizationId(backend.db,tenantId):null;
  const materials=backend.type==="postgres"?await backend.sql`SELECT v.public_id AS variant_id,i.quantity,i.unit_cost FROM service_order_items i JOIN service_orders s ON s.id=i.service_order_id JOIN inventory_variants v ON v.id=i.inventory_variant_id WHERE s.public_id=${serviceId} AND s.organization_id=v.organization_id AND i.kind='material'`
    :backend.db.prepare(`SELECT v.public_id AS variant_id,i.quantity,i.unit_cost FROM service_order_items i JOIN service_orders s ON s.id=i.service_order_id JOIN inventory_variants v ON v.id=i.inventory_variant_id WHERE s.public_id=? AND s.organization_id=v.organization_id AND i.kind='material'`).all(serviceId);
  const lines=[];
  for(const material of materials){let remaining=Number(material.quantity);const lots=backend.type==="postgres"?await backend.sql`SELECT m.lot_code,m.expires_on,SUM(m.quantity_delta) available FROM inventory_movements m JOIN inventory_variants v ON v.id=m.variant_id WHERE v.public_id=${material.variant_id} AND m.organization_id=v.organization_id GROUP BY m.lot_code,m.expires_on HAVING SUM(m.quantity_delta)>0 ORDER BY m.expires_on NULLS LAST`
      :backend.db.prepare(`SELECT m.lot_code,m.expires_on,SUM(m.quantity_delta) available FROM inventory_movements m JOIN inventory_variants v ON v.id=m.variant_id WHERE v.public_id=? AND m.organization_id IS ? AND m.organization_id IS v.organization_id GROUP BY m.lot_code,m.expires_on HAVING SUM(m.quantity_delta)>0 ORDER BY CASE WHEN m.expires_on IS NULL THEN 1 ELSE 0 END,m.expires_on`).all(material.variant_id,orgId);
    for(const lot of lots){if(remaining<=0)break;const quantity=Math.min(remaining,Number(lot.available));lines.push({variantId:material.variant_id,quantity,unitCost:Number(material.unit_cost),lotCode:lot.lot_code||"",expiresOn:lot.expires_on?String(lot.expires_on).slice(0,10):null});remaining-=quantity;}
    if(remaining>0)lines.push({variantId:material.variant_id,quantity:remaining,unitCost:Number(material.unit_cost),lotCode:"",expiresOn:null});
  }
  return lines;
}

export async function transitionServiceOrder({ tenantId, ownerUserId, serviceId, action }) {
  const backend=await ensureSchema(); const statuses={approve:"approved",schedule:"scheduled",start:"in_progress",cancel:"cancelled"}; const next=statuses[action];
  if(!next) throw new Error("INVALID_SERVICE_TRANSITION");
  const allowed={approve:["quote","draft"],schedule:["approved"],start:["approved","scheduled"],cancel:["quote","draft","approved","scheduled","in_progress"]}[action];
  const allowedStatus=[allowed[0],allowed[1]||allowed[0],allowed[2]||allowed[0],allowed[3]||allowed[0],allowed[4]||allowed[0]];
  if(backend.type==="postgres") { const rows=await backend.sql.transaction((tx)=>[
    tx`UPDATE service_orders SET status=${next},updated_at=NOW() WHERE public_id=${serviceId} AND owner_user_id=${ownerUserId}
      AND organization_id=(SELECT id FROM organizations WHERE ${tenantId}='organization:'||id::text)
      AND status IN (${allowedStatus[0]},${allowedStatus[1]},${allowedStatus[2]},${allowedStatus[3]},${allowedStatus[4]}) RETURNING public_id`,
    tx`INSERT INTO outbox_events(public_id,organization_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload)
      SELECT ${randomUUID()},organization_id,'service_order',${serviceId},${`service.${next}`},${`service:${serviceId}:${next}`},${JSON.stringify({status:next})}::jsonb FROM service_orders WHERE public_id=${serviceId} AND status=${next} ON CONFLICT(event_type,dedupe_key) DO NOTHING`,
  ],{isolationLevel:"Serializable"}); if(!rows[0]?.length) return null; }
  else { const db=backend.db,orgId=organizationId(db,tenantId); db.exec("BEGIN IMMEDIATE"); try { const placeholders=allowed.map(()=>"?").join(","); const changed=db.prepare(`UPDATE service_orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE public_id=? AND owner_user_id=? AND organization_id=? AND status IN (${placeholders})`).run(next,serviceId,ownerUserId,orgId,...allowed); if(!changed.changes){db.exec("ROLLBACK");return null;}
      db.prepare(`INSERT OR IGNORE INTO outbox_events(public_id,organization_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload) VALUES(?,?,'service_order',?,?,?,?)`).run(randomUUID(),orgId,serviceId,`service.${next}`,`service:${serviceId}:${next}`,JSON.stringify({status:next})); db.exec("COMMIT"); } catch(error){db.exec("ROLLBACK");throw error;} }
  return {id:serviceId,status:next};
}

export async function completeServiceOrder({ tenantId, ownerUserId, serviceId }) {
  const backend=await ensureSchema(); const commitmentId=randomUUID(),eventId=randomUUID(),nextId=randomUUID(),batchId=randomUUID();
  const source=backend.type==="postgres"?(await backend.sql`SELECT * FROM service_orders WHERE public_id=${serviceId} AND owner_user_id=${ownerUserId} AND organization_id=(SELECT id FROM organizations WHERE ${tenantId}='organization:'||id::text)`)[0]
    :backend.db.prepare("SELECT * FROM service_orders WHERE public_id=? AND owner_user_id=? AND organization_id=?").get(serviceId,ownerUserId,organizationId(backend.db,tenantId));
  if(!source||source.status!=="in_progress") return null;
  const materialLines=await serviceMaterialLines(backend,tenantId,serviceId);
  const costRow=backend.type==="postgres"?(await backend.sql`SELECT COALESCE(SUM(i.quantity*i.unit_cost),0) cost FROM service_order_items i JOIN service_orders s ON s.id=i.service_order_id WHERE s.public_id=${serviceId}`)[0]
    :backend.db.prepare("SELECT COALESCE(SUM(i.quantity*i.unit_cost),0) cost FROM service_order_items i JOIN service_orders s ON s.id=i.service_order_id WHERE s.public_id=?").get(serviceId);
  const actualCost=Number(costRow?.cost)||0; const createNext=source.recurrence!=="none"&&Number(source.recurrence_index)<Number(source.recurrence_count); const scheduled=nextDate(source.scheduled_for,source.recurrence);
  if(backend.type==="postgres") { const transactionRows=await backend.sql.transaction((tx)=>[
    tx`SELECT pg_advisory_xact_lock(hashtext(${serviceId}))`,
    tx`INSERT INTO outbox_events(public_id,organization_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload)
      SELECT ${eventId},organization_id,'service_order',${serviceId},'service.completed',${`service:${serviceId}:completed`},${JSON.stringify({commitmentId,createNext})}::jsonb
      FROM service_orders WHERE public_id=${serviceId} AND owner_user_id=${ownerUserId} AND status='in_progress'
      ON CONFLICT(event_type,dedupe_key) DO NOTHING RETURNING public_id`,
    ...(materialLines.length?[tx`INSERT INTO inventory_batches(public_id,tenant_id,organization_id,kind,reference,note,actor_user_id) SELECT ${batchId},${tenantId},organization_id,'service',${serviceId},'Materiais consumidos na ordem de serviço',${ownerUserId} FROM service_orders WHERE public_id=${serviceId} AND EXISTS(SELECT 1 FROM outbox_events WHERE public_id=${eventId})`,
      ...materialLines.map((line)=>tx`WITH changed AS (UPDATE inventory_variants SET quantity=quantity-${line.quantity},updated_at=NOW() WHERE public_id=${line.variantId} AND organization_id=(SELECT organization_id FROM service_orders WHERE public_id=${serviceId}) AND quantity>=${line.quantity} AND EXISTS(SELECT 1 FROM outbox_events WHERE public_id=${eventId}) RETURNING id) INSERT INTO inventory_movements(public_id,tenant_id,organization_id,batch_id,variant_id,kind,quantity_delta,unit_cost,lot_code,expires_on,reason,actor_user_id) SELECT ${randomUUID()},${tenantId},b.organization_id,b.id,changed.id,'service',${-line.quantity},${line.unitCost},${line.lotCode},${line.expiresOn},'Consumo em serviço',${ownerUserId} FROM changed CROSS JOIN inventory_batches b WHERE b.public_id=${batchId}`),
      tx`SELECT 1/CASE WHEN COUNT(*)=${materialLines.length} OR NOT EXISTS(SELECT 1 FROM outbox_events WHERE public_id=${eventId}) THEN 1 ELSE 0 END FROM inventory_movements m JOIN inventory_batches b ON b.id=m.batch_id WHERE b.public_id=${batchId}`]:[]),
    tx`UPDATE service_orders SET status='completed',actual_cost=${actualCost},completed_at=NOW(),updated_at=NOW() WHERE public_id=${serviceId} AND owner_user_id=${ownerUserId} AND status='in_progress' AND EXISTS(SELECT 1 FROM outbox_events WHERE public_id=${eventId})`,
    tx`INSERT INTO financial_commitments(public_id,owner_user_id,organization_id,kind,description,party,category,due_on,expected_amount,status,origin_type,origin_public_id)
      SELECT ${commitmentId},owner_user_id,organization_id,'receivable',title,COALESCE(c.name,''),'Serviços',COALESCE(due_on,CURRENT_DATE),quoted_amount,'pending','service',public_id::text FROM service_orders s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.public_id=${serviceId} AND s.quoted_amount>0 AND EXISTS(SELECT 1 FROM outbox_events WHERE public_id=${eventId})`,
    tx`UPDATE service_orders SET financial_commitment_id=(SELECT id FROM financial_commitments WHERE public_id=${commitmentId}) WHERE public_id=${serviceId} AND EXISTS(SELECT 1 FROM outbox_events WHERE public_id=${eventId})`,
    ...(createNext?[tx`INSERT INTO service_orders(public_id,owner_user_id,organization_id,customer_id,series_public_id,recurrence,recurrence_index,recurrence_count,quote_number,title,description,assignee,location,scheduled_for,due_on,status,quoted_amount,estimated_cost,notes)
      SELECT ${nextId},owner_user_id,organization_id,customer_id,series_public_id,recurrence,recurrence_index+1,recurrence_count,quote_number,title,description,assignee,location,${scheduled},${scheduled?scheduled.slice(0,10):null},'scheduled',quoted_amount,estimated_cost,notes FROM service_orders WHERE public_id=${serviceId} AND EXISTS(SELECT 1 FROM outbox_events WHERE public_id=${eventId})`,
      tx`INSERT INTO service_order_items(service_order_id,kind,description,inventory_variant_id,quantity,unit_price,unit_cost) SELECT n.id,i.kind,i.description,i.inventory_variant_id,i.quantity,i.unit_price,i.unit_cost FROM service_orders n,service_orders s JOIN service_order_items i ON i.service_order_id=s.id WHERE n.public_id=${nextId} AND s.public_id=${serviceId}`]:[]),
  ],{isolationLevel:"Serializable"}); if(!transactionRows[1]?.length)return null; }
  else { const db=backend.db,orgId=organizationId(db,tenantId);db.exec("BEGIN IMMEDIATE");try{const active=db.prepare("SELECT id FROM service_orders WHERE public_id=? AND owner_user_id=? AND organization_id=? AND status='in_progress'").get(serviceId,ownerUserId,orgId);if(!active){db.exec("ROLLBACK");return null;}if(materialLines.length){const batch=db.prepare("INSERT INTO inventory_batches(public_id,tenant_id,organization_id,kind,reference,note,actor_user_id) VALUES(?,?,?,'service',?,'Materiais consumidos na ordem de serviço',?)").run(batchId,tenantId,orgId,serviceId,ownerUserId);for(const line of materialLines){const variant=db.prepare("SELECT id FROM inventory_variants WHERE public_id=? AND organization_id IS ?").get(line.variantId,orgId);const changed=db.prepare("UPDATE inventory_variants SET quantity=quantity-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND quantity>=?").run(line.quantity,variant?.id,line.quantity);if(!changed.changes)throw new Error("INSUFFICIENT_SERVICE_MATERIAL");db.prepare(`INSERT INTO inventory_movements(public_id,tenant_id,organization_id,batch_id,variant_id,kind,quantity_delta,unit_cost,lot_code,expires_on,reason,actor_user_id) VALUES(?,?,?,?,?,'service',?,?,?,?, 'Consumo em serviço',?)`).run(randomUUID(),tenantId,orgId,batch.lastInsertRowid,variant.id,-line.quantity,line.unitCost,line.lotCode,line.expiresOn,ownerUserId);}}db.prepare("UPDATE service_orders SET status='completed',actual_cost=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE public_id=? AND owner_user_id=? AND status='in_progress'").run(actualCost,serviceId,ownerUserId);if(Number(source.quoted_amount)>0){const customer=source.customer_id?db.prepare("SELECT name FROM customers WHERE id=?").get(source.customer_id):null;const commitment=db.prepare(`INSERT INTO financial_commitments(public_id,owner_user_id,organization_id,kind,description,party,category,due_on,expected_amount,status,origin_type,origin_public_id) VALUES(?,?,?,'receivable',?,?, 'Serviços',?,?,'pending','service',?)`).run(commitmentId,ownerUserId,orgId,source.title,customer?.name||"",source.due_on||new Date().toISOString().slice(0,10),source.quoted_amount,serviceId);db.prepare("UPDATE service_orders SET financial_commitment_id=? WHERE public_id=?").run(commitment.lastInsertRowid,serviceId);}if(createNext){const next=db.prepare(`INSERT INTO service_orders(public_id,owner_user_id,organization_id,customer_id,series_public_id,recurrence,recurrence_index,recurrence_count,quote_number,title,description,assignee,location,scheduled_for,due_on,status,quoted_amount,estimated_cost,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'scheduled',?,?,?)`).run(nextId,ownerUserId,orgId,source.customer_id,source.series_public_id,source.recurrence,source.recurrence_index+1,source.recurrence_count,source.quote_number,source.title,source.description,source.assignee,source.location,scheduled,scheduled?.slice(0,10)||null,source.quoted_amount,source.estimated_cost,source.notes);db.prepare("INSERT INTO service_order_items(service_order_id,kind,description,inventory_variant_id,quantity,unit_price,unit_cost) SELECT ?,kind,description,inventory_variant_id,quantity,unit_price,unit_cost FROM service_order_items WHERE service_order_id=?").run(next.lastInsertRowid,source.id);}db.prepare(`INSERT INTO outbox_events(public_id,organization_id,aggregate_type,aggregate_id,event_type,dedupe_key,payload) VALUES(?,?,'service_order',?,'service.completed',?,?)`).run(eventId,orgId,serviceId,`service:${serviceId}:completed`,JSON.stringify({commitmentId,createNext}));db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}}
  return {id:serviceId,commitmentId:Number(source.quoted_amount)>0?commitmentId:null,nextServiceId:createNext?nextId:null};
}

export async function resetServiceSchemaForTests(){schemaPromise=undefined;}
