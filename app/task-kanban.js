"use client";

import { useMemo, useState } from "react";

const COLUMNS = [
  { id: "todo", title: "A fazer", text: "Tarefas ainda não iniciadas" },
  { id: "doing", title: "Em andamento", text: "O que está sendo executado" },
  { id: "done", title: "Concluído", text: "Entregas finalizadas" },
];

function newId() {
  return globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dueState(date, status) {
  if (!date || status === "done") return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${date}T12:00:00`);
  if (due < today) return "overdue";
  if ((due - today) / 86_400_000 <= 3) return "soon";
  return "";
}

export default function TaskKanban({ tasks, setTasks, clients = [] }) {
  const [form, setForm] = useState({ title: "", dueDate: "", priority: "medium", clientId: "" });
  const clientMap = useMemo(() => Object.fromEntries(clients.map((client) => [client.id, client])), [clients]);

  function createTask(event) {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) return;
    setTasks((current) => [...current, { ...form, id: newId(), title, status: "todo", createdAt: new Date().toISOString() }]);
    setForm({ title: "", dueDate: "", priority: "medium", clientId: "" });
  }

  function updateTask(id, changes) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...changes } : task));
  }

  return <div className="business-stack task-workspace">
    <section className="panel task-toolbar">
      <div><span className="eyebrow">ROTINA DA EQUIPE</span><h2>Quadro de tarefas</h2><p>Organize prazos e acompanhe o trabalho sem transformar a operação em algo complicado.</p></div>
      <div className="task-totals"><strong>{tasks.filter((task) => task.status !== "done").length}</strong><span>tarefas abertas</span></div>
    </section>
    <section className="panel">
      <form className="task-create-form" onSubmit={createTask}>
        <label>Tarefa<input required maxLength="120" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Confirmar entrega com o cliente" /></label>
        <label>Prazo<input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
        <label>Prioridade<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select></label>
        <label>Cliente<select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Sem cliente</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label>
        <button className="primary-button" type="submit">+ Criar tarefa</button>
      </form>
    </section>
    <section className="kanban-board" aria-label="Quadro de tarefas">{COLUMNS.map((column) => {
      const columnTasks = tasks.filter((task) => task.status === column.id);
      return <article className={`kanban-column ${column.id}`} key={column.id}>
        <header><div><h3>{column.title}</h3><small>{column.text}</small></div><strong>{columnTasks.length}</strong></header>
        <div className="kanban-list">{columnTasks.map((task) => {
          const deadline = dueState(task.dueDate, task.status);
          const client = clientMap[task.clientId];
          return <div className={`kanban-card priority-${task.priority} ${deadline}`} key={task.id}>
            <div className="kanban-card-top"><span>{task.priority === "high" ? "Alta prioridade" : task.priority === "low" ? "Baixa prioridade" : "Prioridade média"}</span><button type="button" aria-label={`Excluir ${task.title}`} onClick={() => setTasks((current) => current.filter((item) => item.id !== task.id))}>×</button></div>
            <strong>{task.title}</strong>
            {client && <small>Cliente: {client.name}</small>}
            <div className="kanban-card-meta"><span>{task.dueDate ? `${deadline === "overdue" ? "Atrasada · " : "Prazo · "}${new Date(`${task.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}` : "Sem prazo"}</span></div>
            <label>Mover para<select value={task.status} onChange={(event) => updateTask(task.id, { status: event.target.value, completedAt: event.target.value === "done" ? new Date().toISOString() : "" })}>{COLUMNS.map((option) => <option value={option.id} key={option.id}>{option.title}</option>)}</select></label>
          </div>;
        })}{!columnTasks.length && <p>Nenhuma tarefa nesta etapa.</p>}</div>
      </article>;
    })}</section>
  </div>;
}
