import { useEffect, useRef, useState } from 'react';
import type { ScanBox } from '../../../lib/plateOcr';

interface Props {
  onClose: () => void;
  onCapture: (dataUrl: string, box: ScanBox) => void;
}

// Guide rectangle shown on the camera (percentages of the rendered frame).
export const SCAN_BOX: ScanBox = { x: 0.02, y: 0.33, w: 0.96, h: 0.34 };
// The captured frame already matches the guide, so OCR uses the whole frame.
export const FULL_BOX: ScanBox = { x: 0, y: 0, w: 1, h: 1 };

// Maps a rectangle in container space to video coordinates for object-fit: cover.
function coverRegion(container: HTMLDivElement, videoW: number, videoH: number, box: ScanBox) {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const scale = Math.max(cw / videoW, ch / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  const x = (box.x * cw - ox) / scale;
  const y = (box.y * ch - oy) / scale;
  const w = (box.w * cw) / scale;
  const h = (box.h * ch) / scale;
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    w: Math.min(videoW - Math.max(0, x), w),
    h: Math.min(videoH - Math.max(0, y), h)
  };
}

export function PlateScanner({ onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        if (!cancelled) setError('No se pudo acceder a la cámara. Usa "Subir foto" para elegir una imagen manualmente.');
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    const view = viewRef.current;
    if (!video || !video.videoWidth || !view) return;

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    const region = coverRegion(view, videoW, videoH, SCAN_BOX);
    if (region.w <= 0 || region.h <= 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(region.w);
    canvas.height = Math.round(region.h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    onCapture(canvas.toDataURL('image/jpeg', 0.9), FULL_BOX);
  };

  return (
    <div className="modal-overlay plate-scanner-overlay" onClick={onClose}>
      <div className="plate-scanner" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Escanear matrícula</h3>
            <p className="text-on-surface-variant">Ubica la matrícula completa dentro del rectángulo y presiona "Capturar placa".</p>
          </div>
          <button className="modal-close" onClick={onClose} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div ref={viewRef} className="plate-scanner-view">
          <video ref={videoRef} autoPlay playsInline muted />
          <div className="plate-scan-box">
            <span className="plate-scan-corner plate-scan-tl" />
            <span className="plate-scan-corner plate-scan-tr" />
            <span className="plate-scan-corner plate-scan-bl" />
            <span className="plate-scan-corner plate-scan-br" />
          </div>
          {!ready && !error && <div className="plate-scan-loading">Iniciando cámara...</div>}
        </div>
        {error && <p className="text-muted">{error}</p>}
        <div className="form-actions">
          <button className="btn-cancel" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={capture} disabled={!ready}>{ready ? 'Capturar placa' : 'Iniciando cámara...'}</button>
        </div>
      </div>
    </div>
  );
}