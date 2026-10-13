import { CoreValidationError } from "./core-commands";

export const NOTEBOOK_AUDIO_RATE = 16000;
export const NOTEBOOK_AUDIO_MAX_BYTES = 44 + NOTEBOOK_AUDIO_RATE * 2 * 300;
// Canonical mono PCM WAV; the server derives duration from verified sample data.
export function notebookWav(samples: Float32Array, sampleRate = NOTEBOOK_AUDIO_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true));
  return buffer;
}
export function notebookWavDuration(bytes: ArrayBuffer) {
  const fail = (): never => { throw new CoreValidationError("El audio debe ser WAV mono PCM a 16 kHz, de hasta cinco minutos.", 422); };
  if (bytes.byteLength < 46 || bytes.byteLength > NOTEBOOK_AUDIO_MAX_BYTES) return fail();
  const view = new DataView(bytes), word = (at: number) => String.fromCharCode(...new Uint8Array(bytes, at, 4));
  if (word(0) !== "RIFF" || word(8) !== "WAVE" || word(12) !== "fmt " || word(36) !== "data" || view.getUint32(4, true) !== bytes.byteLength - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== NOTEBOOK_AUDIO_RATE || view.getUint32(28, true) !== NOTEBOOK_AUDIO_RATE * 2 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.byteLength - 44 || (bytes.byteLength - 44) % 2 !== 0) return fail();
  return (bytes.byteLength - 44) / (NOTEBOOK_AUDIO_RATE * 2);
}
