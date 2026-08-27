"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { exportFileBase, exportFileNameError, safeExportFilename } from "../lib/export-filename";

export function useFileNameDialog() {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);
  const trigger = useRef(null);

  const close = useCallback((filename = null) => {
    resolver.current?.(filename);
    resolver.current = null;
    setRequest(null);
    window.setTimeout(() => trigger.current?.focus?.(), 0);
  }, []);

  const cancel = useCallback(() => close(null), [close]);

  const requestFileName = useCallback(({ suggestedName, extension, description = "" }) => {
    resolver.current?.(null);
    return new Promise((resolve) => {
      resolver.current = resolve;
      trigger.current = document.activeElement;
      setRequest({
        suggestedName: exportFileBase(suggestedName, extension),
        extension,
        description,
      });
    });
  }, []);

  useEffect(() => () => resolver.current?.(null), []);

  return {
    requestFileName,
    fileNameDialogProps: request ? { ...request, onCancel: cancel, onConfirm: close } : null,
  };
}

export default function FileNameDialog({ suggestedName, extension, description, onCancel, onConfirm }) {
  const [name, setName] = useState(suggestedName || "arquivo-candtech");
  const [touched, setTouched] = useState(false);
  const error = touched ? exportFileNameError(name) : "";
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCancel();
      if (event.key === "Tab") {
        const focusable = [...dialogRef.current.querySelectorAll("input, button:not([disabled])")];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function submit(event) {
    event.preventDefault();
    setTouched(true);
    const validationError = exportFileNameError(name);
    if (validationError) return;
    onConfirm(safeExportFilename(name, extension, suggestedName));
  }

  return (
    <div className="file-name-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section ref={dialogRef} className="file-name-dialog" role="dialog" aria-modal="true" aria-labelledby="file-name-dialog-title" aria-describedby="file-name-dialog-description">
        <form onSubmit={submit} noValidate>
          <div className="file-name-dialog-heading">
            <span className="eyebrow">EXPORTAR ARQUIVO</span>
            <h2 id="file-name-dialog-title">Coloque o nome do arquivo</h2>
            <p id="file-name-dialog-description">{description || "Escolha um nome fácil de reconhecer. A extensão será adicionada automaticamente."}</p>
          </div>
          <label className="file-name-field" htmlFor="export-file-name">
            <span>Nome do arquivo</span>
            <span className={error ? "file-name-input error" : "file-name-input"}>
              <input
                ref={inputRef}
                id="export-file-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "file-name-error" : "file-name-help"}
              />
              <strong>.{extension}</strong>
            </span>
          </label>
          {error ? <p className="file-name-error" id="file-name-error" role="alert">{error}</p> : <p className="file-name-help" id="file-name-help">Você poderá localizar o arquivo por este nome no dispositivo ou no Google Drive.</p>}
          <div className="file-name-dialog-actions">
            <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>
            <button type="submit" className="primary-button">Continuar</button>
          </div>
        </form>
      </section>
    </div>
  );
}
