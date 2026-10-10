import { redirect } from 'next/navigation';
import { AuthError, requireOwner } from '@/lib/supabase-auth';
import { BackupDownload } from './backup-download';
export const dynamic = 'force-dynamic';
export default async function Deployment() {
  try { await requireOwner(); } catch (error) { if (error instanceof AuthError) redirect('/login'); throw error; }
  return <main className="content-shell"><section className="panel">
    <a href="/">← Volver a Project OS</a>
    <h1>Respaldo para el despliegue</h1>
    <p>Descarga el historial auxiliar de IA, análisis de reuniones, vínculos con GBrain y búsqueda en documentos.</p>
    <p>Los proyectos, tareas y originales permanecen en el mismo Supabase. Esta copia no incluye variables de entorno ni sustituye un respaldo de Supabase o de GBrain.</p>
    <p>El archivo contiene información privada de tus proyectos. No lo subas a GitHub ni lo compartas públicamente. Guárdalo en un lugar protegido.</p>
    <p>Antes de la copia definitiva, termina los análisis en curso y deja de editar el sitio anterior durante la transferencia. No uses simultáneamente ambos alojamientos.</p>
    <BackupDownload />
  </section></main>;
}
