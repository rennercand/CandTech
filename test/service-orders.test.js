import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabaseForTests, createUser, ensureOwnedOrganization, getDatabaseBackend } from "../lib/db.js";
import { completeServiceOrder, createServiceOrder, listServiceOrders, resetServiceSchemaForTests, transitionServiceOrder } from "../lib/service-db.js";
import { applyInventoryBatch, createInventoryProducts, listInventory, resetInventorySchemaForTests } from "../lib/inventory-db.js";

test("ordem de serviço percorre orçamento, agenda, conclusão, cobrança e recorrência", async () => {
  const previous={nodeEnv:process.env.NODE_ENV,sqlitePath:process.env.SQLITE_DATABASE_PATH}; const directory=mkdtempSync(join(tmpdir(),"candtech-services-"));
  process.env.NODE_ENV="test"; process.env.SQLITE_DATABASE_PATH=join(directory,"services.sqlite");
  try {
    const owner=await createUser({name:"Serviços",email:"services@test.local",passwordHash:"hash",accountType:"company"});
    const organization=await ensureOwnedOrganization({userId:owner.id,name:"Serviços"}); const tenantId=`organization:${organization.organizationId}`;
    await listInventory(tenantId);
    const [product]=await createInventoryProducts({tenantId,products:[{name:"Peça",category:"Materiais",unit:"un",variants:[{name:"Padrão",sku:"PECA-1",minimumQuantity:1,unitCost:10,salePrice:20,location:""}]}]});
    await applyInventoryBatch({tenantId,userId:owner.id,kind:"entry",reference:"MAT-1",lines:[{variantId:product.variants[0].id,quantity:5,delta:5,unitCost:10,lotCode:"MAT-A",expiresOn:"2027-01-01"}]});
    const created=await createServiceOrder({tenantId,ownerUserId:owner.id,data:{customerId:"",quoteNumber:"ORC-1",title:"Manutenção preventiva",description:"Revisar equipamento",assignee:"Técnico A",location:"Cliente",scheduledFor:"2026-09-02T13:00:00.000Z",dueOn:"2026-09-05",status:"quote",recurrence:"monthly",recurrenceCount:3,quotedAmount:300,estimatedCost:100,notes:"",items:[{kind:"service",description:"Manutenção",variantId:"",quantity:1,unitPrice:280,unitCost:80},{kind:"material",description:"Peça",variantId:product.variants[0].id,quantity:2,unitPrice:10,unitCost:10}]}});
    assert.equal((await listServiceOrders(tenantId))[0].status,"quote");
    assert.equal(await completeServiceOrder({tenantId,ownerUserId:owner.id,serviceId:created.id}),null,"não conclui antes da execução");
    await assert.rejects(createServiceOrder({tenantId,ownerUserId:owner.id,data:{customerId:"",quoteNumber:"INVÁLIDO",title:"Material externo",description:"",assignee:"",location:"",scheduledFor:"",dueOn:"",status:"draft",recurrence:"none",recurrenceCount:1,quotedAmount:10,estimatedCost:1,notes:"",items:[{kind:"material",description:"SKU inexistente",variantId:"00000000-0000-4000-8000-000000000000",quantity:1,unitPrice:10,unitCost:1}]}}),/INVALID_SERVICE_MATERIAL/);
    assert.equal((await listServiceOrders(tenantId)).length,1,"material inválido reverte a ordem inteira");
    assert.equal((await transitionServiceOrder({tenantId,ownerUserId:owner.id,serviceId:created.id,action:"approve"})).status,"approved");
    assert.equal((await transitionServiceOrder({tenantId,ownerUserId:owner.id,serviceId:created.id,action:"schedule"})).status,"scheduled");
    assert.equal((await transitionServiceOrder({tenantId,ownerUserId:owner.id,serviceId:created.id,action:"start"})).status,"in_progress");
    const completed=await completeServiceOrder({tenantId,ownerUserId:owner.id,serviceId:created.id});
    assert.ok(completed.commitmentId); assert.ok(completed.nextServiceId);
    const services=await listServiceOrders(tenantId); assert.equal(services.length,2);
    assert.equal(services.find((item)=>item.id===created.id).status,"completed");
    assert.equal(services.find((item)=>item.id===created.id).actualCost,100);
    assert.equal((await listInventory(tenantId)).products[0].variants[0].quantity,3);
    const next=services.find((item)=>item.id===completed.nextServiceId); assert.equal(next.status,"scheduled"); assert.equal(next.recurrenceIndex,2);
    const backend=await getDatabaseBackend();
    const commitment=backend.db.prepare("SELECT expected_amount,status,origin_type,origin_public_id FROM financial_commitments WHERE public_id=?").get(completed.commitmentId);
    assert.deepEqual({expected_amount:commitment.expected_amount,status:commitment.status,origin_type:commitment.origin_type,origin_public_id:commitment.origin_public_id},{expected_amount:300,status:"pending",origin_type:"service",origin_public_id:created.id});
    assert.equal(backend.db.prepare("SELECT COUNT(*) count FROM outbox_events WHERE aggregate_id=?").get(created.id).count,5);
    assert.equal(await completeServiceOrder({tenantId,ownerUserId:owner.id,serviceId:created.id}),null);
    const shortage=await createServiceOrder({tenantId,ownerUserId:owner.id,data:{customerId:"",quoteNumber:"ORC-2",title:"Serviço sem saldo",description:"",assignee:"Técnico A",location:"",scheduledFor:"2026-09-03T13:00:00.000Z",dueOn:"2026-09-06",status:"draft",recurrence:"none",recurrenceCount:1,quotedAmount:500,estimatedCost:990,notes:"",items:[{kind:"material",description:"Peça",variantId:product.variants[0].id,quantity:99,unitPrice:5,unitCost:10}]}});
    await transitionServiceOrder({tenantId,ownerUserId:owner.id,serviceId:shortage.id,action:"approve"});
    await transitionServiceOrder({tenantId,ownerUserId:owner.id,serviceId:shortage.id,action:"start"});
    await assert.rejects(completeServiceOrder({tenantId,ownerUserId:owner.id,serviceId:shortage.id}),/INSUFFICIENT_SERVICE_MATERIAL/);
    assert.equal((await listServiceOrders(tenantId)).find((item)=>item.id===shortage.id).status,"in_progress");
    assert.equal((await listInventory(tenantId)).products[0].variants[0].quantity,3,"falha de saldo não baixa estoque parcial");
    assert.equal(backend.db.prepare("SELECT COUNT(*) count FROM financial_commitments WHERE origin_type='service'").get().count,1,"falha de saldo não cria cobrança");
  } finally { await closeDatabaseForTests(); await resetServiceSchemaForTests(); await resetInventorySchemaForTests(); if(previous.nodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous.nodeEnv;if(previous.sqlitePath===undefined)delete process.env.SQLITE_DATABASE_PATH;else process.env.SQLITE_DATABASE_PATH=previous.sqlitePath;rmSync(directory,{recursive:true,force:true}); }
});
