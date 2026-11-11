// Framed camera: a live viewfinder seen through one of the two frames. What is inside the
// frame's window is what gets captured. Also image helpers for stickers, washi and covers.

import { $, toast } from './dom.js';

// Window position inside each frame image, as fractions of the frame's width / height.
const FRAMES = {
  sticker: { src: 'assets/frames/square.webp', ratio: 679 / 760, win: [0.2123, 0.2269, 0.7738, 0.6803], hint: 'Çıkartma olacak şeyi kareye sığdır' },
  washi: { src: 'assets/frames/bookmark.webp', ratio: 363 / 760, win: [0.2135, 0.1282, 0.7649, 0.7199], hint: 'Bant olacak dokuyu çerçeveye doldur' },
};

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Görsel okunamadı.'));
    im.src = src;
  });
}

export function fileToImage(file) {
  if (!file || !file.type.startsWith('image/')) return Promise.reject(new Error('Lütfen bir görsel seç.'));
  const url = URL.createObjectURL(file);
  return loadImage(url).finally(() => setTimeout(() => URL.revokeObjectURL(url), 2000));
}

/** Centre-crop any drawable to a target aspect ratio and size. */
function cropTo(source, sw, sh, aspect, outW) {
  let w = sw, h = sw / aspect;
  if (h > sh) { h = sh; w = sh * aspect; }
  const c = document.createElement('canvas');
  c.width = Math.round(outW); c.height = Math.round(outW / aspect);
  c.getContext('2d').drawImage(source, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, c.width, c.height);
  return c;
}

function hasTransparency(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) clear++;
  return clear > d.length / (4 * 7) * 0.02;
}

/**
 * Turn an image into a sticker.
 * A picture that already has a transparent background (for example a subject lifted in
 * iPhone Photos) is kept as it is; a normal photo becomes a white-bordered sticker.
 */
export function makeSticker(image, { square = false } = {}) {
  const sw = image.naturalWidth || image.videoWidth || image.width, sh = image.naturalHeight || image.videoHeight || image.height;
  const k = Math.min(1, 512 / Math.max(sw, sh));
  const raw = document.createElement('canvas');
  raw.width = Math.max(1, Math.round(sw * k)); raw.height = Math.max(1, Math.round(sh * k));
  raw.getContext('2d').drawImage(image, 0, 0, raw.width, raw.height);
  if (!square && hasTransparency(raw)) return raw.toDataURL('image/png');
  const photo = cropTo(raw, raw.width, raw.height, square ? 1 : raw.width / raw.height, Math.min(440, raw.width));
  const pad = 18, c = document.createElement('canvas');
  c.width = photo.width + pad * 2; c.height = photo.height + pad * 2;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.beginPath(); x.roundRect(0, 0, c.width, c.height, 34); x.fill();
  x.save(); x.beginPath(); x.roundRect(pad, pad, photo.width, photo.height, 22); x.clip(); x.drawImage(photo, pad, pad); x.restore();
  return c.toDataURL('image/png');
}

/** A washi texture: the picture laid on its side so its long edge runs along the tape. */
export function makeWashi(image) {
  const sw = image.naturalWidth || image.width, sh = image.naturalHeight || image.height;
  const H = 96, c = document.createElement('canvas');
  if (sh > sw) {
    c.width = Math.round((sh / sw) * H); c.height = H;
    const x = c.getContext('2d');
    x.translate(0, H); x.rotate(-Math.PI / 2); x.drawImage(image, 0, 0, H, c.width);
  } else {
    c.width = Math.round((sw / sh) * H); c.height = H;
    c.getContext('2d').drawImage(image, 0, 0, c.width, H);
  }
  return c.toDataURL('image/jpeg', 0.88);
}

/** A project folder cover from any photo. */
export function makeCover(image) {
  const sw = image.naturalWidth || image.width, sh = image.naturalHeight || image.height;
  return cropTo(image, sw, sh, 5 / 4, 600).toDataURL('image/jpeg', 0.86);
}

/** Read an image the user copied (e.g. a subject lifted in Photos). Needs a tap to be allowed. */
export async function imageFromClipboard() {
  if (!navigator.clipboard?.read) throw new Error('Bu tarayıcı panodan görsel okumaya izin vermiyor. Görseli kaydedip galeriden seç.');
  const items = await navigator.clipboard.read();
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith('image/'));
    if (type) { const blob = await it.getType(type); return fileToImage(new File([blob], 'pano', { type })); }
  }
  throw new Error('Panoda görsel yok. Fotoğraflar’da nesneye basılı tutup “Kopyala” de, sonra tekrar dene.');
}

/**
 * Open the framed camera. Resolves with a canvas of what was inside the frame's window,
 * or null if the user closed it. Falls back to the system camera when live video is unavailable.
 */
export function openCamera(kind) {
  const f = FRAMES[kind], [x0, y0, x1, y1] = f.win;
  const aspect = ((x1 - x0) * f.ratio) / (y1 - y0); // window width / height
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'cam';
    el.innerHTML = `<button class="icon-btn cam-close" aria-label="Kapat"><svg class="ic"><use href="#i-close"/></svg></button>
      <p class="cam-hint">${f.hint}</p>
      <div class="cam-frame" style="aspect-ratio:${f.ratio};--fr:${f.ratio}">
        <video playsinline autoplay muted style="left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;height:${(y1 - y0) * 100}%"></video>
        <img src="${f.src}" alt="" draggable="false">
        <button class="cam-shutter" aria-label="Fotoğrafı çek"></button>
      </div>
      <label class="btn ghost sm cam-file">Galeriden seç<input type="file" accept="image/*" hidden></label>`;
    document.body.appendChild(el);
    const video = $('video', el);
    let stream = null, done = false;
    const finish = (canvas) => {
      if (done) return;
      done = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      el.remove();
      resolve(canvas);
    };
    $('.cam-close', el).onclick = () => finish(null);
    $('.cam-shutter', el).onclick = () => {
      if (!video.videoWidth) { toast('Kamera hazır değil; galeriden seçebilirsin.'); return; }
      finish(cropTo(video, video.videoWidth, video.videoHeight, aspect, kind === 'washi' ? 360 : 600));
    };
    $('input', el).onchange = async (e) => {
      try { const im = await fileToImage(e.target.files[0]); finish(cropTo(im, im.naturalWidth, im.naturalHeight, aspect, kind === 'washi' ? 360 : 600)); }
      catch (err) { toast(err.message); }
    };
    if (!navigator.mediaDevices?.getUserMedia) { el.classList.add('no-live'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => { if (done) { s.getTracks().forEach((t) => t.stop()); return; } stream = s; video.srcObject = s; return video.play(); })
      .catch(() => { el.classList.add('no-live'); toast('Kameraya erişilemedi. Galeriden seçebilirsin.'); });
  });
}
