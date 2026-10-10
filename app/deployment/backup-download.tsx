'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
export function BackupDownload() {
  const [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  async function download() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/deployment/backup',{method:'POST',cache:'no-store'});
      if (!response.ok) { const body = await response.json() as {error?:string}; throw new Error(body.error || 'No se pudo descargar la copia.'); }
      const blob = await response.blob(), url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = response.headers.get('content-disposition')?.match(/filename="([a-zA-Z0-9._-]+)"/)?.[1] || 'project-os-history.json';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url),60000);
      setMessage('Copia preparada y descarga iniciada. Confirma que el archivo se guardó antes de continuar.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo descargar la copia.'); }
    finally { setBusy(false); }
  }
  return <><Button disabled={busy} onClick={() => void download()}>{busy ? 'Preparando copia…' : 'Descargar historial para el VPS'}</Button><p role="status" aria-live="polite">{message}</p></>;
}
