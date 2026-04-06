const canvas = document.getElementById('panorama');
const ctx = canvas.getContext('2d');

const sourceCanvas = document.createElement('canvas');
const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
const renderCanvas = document.createElement('canvas');
const renderCtx = renderCanvas.getContext('2d');
const viewerEl = document.getElementById('viewer');
const hotspotLayer = document.createElement('div');

hotspotLayer.id = 'hotspot-layer';
viewerEl.appendChild(hotspotLayer);

const assetModal = document.getElementById('asset-modal');
const assetBackdrop = document.getElementById('asset-modal-backdrop');
const assetCloseBtn = document.getElementById('asset-close');
const assetTitle = document.getElementById('asset-title');
const assetKicker = document.getElementById('asset-kicker');
const assetDescription = document.getElementById('asset-description');
const assetImage = document.getElementById('asset-image');
const assetEmptyState = document.getElementById('asset-empty-state');
const assetDots = document.getElementById('asset-dots');
const assetThumbs = document.getElementById('asset-thumbs');
const assetPrev = document.getElementById('asset-prev');
const assetNext = document.getElementById('asset-next');
const assetGalleryStage = document.querySelector('.asset-gallery-stage');
const mobileSceneToggle = document.getElementById('mobile-scene-toggle');
const mobileSceneCurrent = document.getElementById('mobile-scene-current');
const mobileScenePanel = document.getElementById('mobile-scene-panel');
const mobileSceneClose = document.getElementById('mobile-scene-close');
const mobileSceneList = document.getElementById('mobile-scene-list');

let currentScene = -1;
let yaw = 0;
let pitch = 0;
let targetYaw = 0;
let targetPitch = 0;
let fov = 120;
let isDragging = false;
let lastX = 0;
let lastY = 0;
let autoRotate = false;
let imageCache = {};
let currentImage = null;
let sourcePixels = null;
let sourceWidth = 0;
let sourceHeight = 0;
let lastRenderKey = '';
let outputWidth = 0;
let outputHeight = 0;
let needsRender = true;
let lastFrameTime = 0;
let renderQuality = 1;
let qualityBoostTimer = null;
let renderImageData = null;
let rayCacheKey = '';
let rayDirections = null;

const MAX_SOURCE_WIDTH = 6144;
const BASE_MAX_PIXELS_DESKTOP = 1600000;
const BASE_MAX_PIXELS_MOBILE = 700000;
const INTERACTION_QUALITY = 0.65;
const IDLE_QUALITY = 1;
const INTERACTION_SETTLE_MS = 140;
const TOUCH_YAW_SENSITIVITY = 0.42;
const TOUCH_PITCH_SENSITIVITY = 0.34;

let transitioning = false;
let transitionAlpha = 0;
let transitionDir = 1;
let transitionTarget = -1;
const TRANS_SPEED = 0.055;

let hotspotElements = [];
let currentAsset = null;
let currentAssetImageIndex = 0;
let galleryTouchStartX = null;
let galleryTouchDeltaX = 0;
let isMobileScenePanelOpen = false;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  updateRenderResolution();
  needsRender = true;
}

window.addEventListener('resize', resize);

function prepareSourceImage(img) {
  const scale = Math.min(1, MAX_SOURCE_WIDTH / img.naturalWidth);
  sourceWidth = Math.max(1, Math.round(img.naturalWidth * scale));
  sourceHeight = Math.max(1, Math.round(img.naturalHeight * scale));
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  sourceCtx.clearRect(0, 0, sourceWidth, sourceHeight);
  sourceCtx.drawImage(img, 0, 0, sourceWidth, sourceHeight);
  sourcePixels = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;
  lastRenderKey = '';
  needsRender = true;
}

function updateRenderResolution(force = false) {
  const baseMaxPixels = window.innerWidth <= 768 ? BASE_MAX_PIXELS_MOBILE : BASE_MAX_PIXELS_DESKTOP;
  const maxPixels = Math.max(180000, Math.round(baseMaxPixels * renderQuality));
  const aspect = canvas.width / canvas.height;
  const targetWidth = Math.min(canvas.width, Math.max(320, Math.round(Math.sqrt(maxPixels * aspect))));
  const targetHeight = Math.max(180, Math.round(targetWidth / aspect));

  if (!force && targetWidth === outputWidth && targetHeight === outputHeight) return;

  renderCanvas.width = targetWidth;
  renderCanvas.height = targetHeight;
  outputWidth = targetWidth;
  outputHeight = targetHeight;
  renderImageData = renderCtx.createImageData(outputWidth, outputHeight);
  rayCacheKey = '';
  lastRenderKey = '';
  needsRender = true;
}

function updateRayCache() {
  const cacheKey = `${outputWidth}:${outputHeight}:${Math.round(fov * 10)}`;
  if (cacheKey === rayCacheKey) return;

  const tanHalfH = Math.tan((fov * Math.PI / 180) / 2);
  const tanHalfV = tanHalfH * (outputHeight / outputWidth);
  const rays = new Float32Array(outputWidth * outputHeight * 3);
  let index = 0;

  for (let yPos = 0; yPos < outputHeight; yPos++) {
    const ny = (1 - 2 * ((yPos + 0.5) / outputHeight)) * tanHalfV;
    for (let xPos = 0; xPos < outputWidth; xPos++) {
      const nx = (2 * ((xPos + 0.5) / outputWidth) - 1) * tanHalfH;
      const inv = 1 / Math.hypot(nx, ny, 1);
      rays[index++] = nx * inv;
      rays[index++] = ny * inv;
      rays[index++] = inv;
    }
  }

  rayDirections = rays;
  rayCacheKey = cacheKey;
  lastRenderKey = '';
}

function enterInteractionMode() {
  if (renderQuality !== INTERACTION_QUALITY) {
    renderQuality = INTERACTION_QUALITY;
    updateRenderResolution();
  }

  clearTimeout(qualityBoostTimer);
  qualityBoostTimer = setTimeout(() => {
    renderQuality = IDLE_QUALITY;
    updateRenderResolution();
  }, INTERACTION_SETTLE_MS);

  needsRender = true;
}

resize();

function normalizeAngle(deg) {
  let value = deg % 360;
  if (value < -180) value += 360;
  if (value > 180) value -= 360;
  return value;
}

function getDirectionFromAngles(hotYaw, hotPitch) {
  const hotYawRad = hotYaw * Math.PI / 180;
  const hotPitchRad = hotPitch * Math.PI / 180;
  return {
    x: Math.sin(hotYawRad) * Math.cos(hotPitchRad),
    y: Math.sin(hotPitchRad),
    z: Math.cos(hotYawRad) * Math.cos(hotPitchRad)
  };
}

function projectWorldPoint(wx, wy, wz) {
  const camYawRad = yaw * Math.PI / 180;
  const camPitchRad = pitch * Math.PI / 180;

  const cosY = Math.cos(-camYawRad);
  const sinY = Math.sin(-camYawRad);
  const rx = wx * cosY - wz * sinY;
  const ry = wy;
  const rz = wx * sinY + wz * cosY;

  const cosP = Math.cos(-camPitchRad);
  const sinP = Math.sin(-camPitchRad);
  const cx = rx;
  const cy = ry * cosP - rz * sinP;
  const cz = ry * sinP + rz * cosP;

  if (cz <= 0.01) return null;

  const tanHalfFov = Math.tan((fov * Math.PI / 180) / 2);
  const aspect = canvas.width / canvas.height;
  const sx = (cx / (cz * tanHalfFov * aspect)) * 0.5 + 0.5;
  const sy = (cy / (cz * tanHalfFov)) * -0.5 + 0.5;

  if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return null;

  return {
    x: sx * (canvas.width / (window.devicePixelRatio || 1)),
    y: sy * (canvas.height / (window.devicePixelRatio || 1)),
    depth: cz
  };
}

function projectToScreen(hotYaw, hotPitch) {
  const direction = getDirectionFromAngles(hotYaw, hotPitch);
  return projectWorldPoint(direction.x, direction.y, direction.z);
}

function stopAutoRotate() {
  autoRotate = false;
  document.getElementById('autorotate-indicator').style.opacity = '0';
}

function setMobileScenePanel(open) {
  isMobileScenePanelOpen = open;
  mobileScenePanel.classList.toggle('hidden', !open);
  mobileScenePanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  mobileSceneToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function getSceneSection(scene) {
  return scene.name.startsWith('Exterior') ? 'Exterior' : 'Interior';
}

function buildHotspots(scene) {
  hotspotLayer.innerHTML = '';
  hotspotElements = [];

  const hotspotGroups = [
    { items: scene?.hotspots || [], kind: 'nav' },
    { items: scene?.assetHotspots || [], kind: 'asset' }
  ];

  hotspotGroups.forEach(group => {
    group.items.forEach((hotspot, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `hotspot-button ${group.kind === 'asset' ? 'asset-hotspot' : 'nav-hotspot'}`;
      button.dataset.index = String(index);
      button.dataset.kind = group.kind;
      button.setAttribute(
        'aria-label',
        group.kind === 'asset'
          ? hotspot.title || hotspot.label || `Asset hotspot ${index + 1}`
          : hotspot.label || SCENES[hotspot.targetScene]?.name || `Scene ${hotspot.targetScene + 1}`
      );

      if (group.kind === 'asset') {
        const hitScale = hotspot.hitScale || 1;
        const hitSize = 148 * hitScale;
        button.style.width = `${hitSize}px`;
        button.style.height = `${hitSize}px`;
        button.style.marginLeft = `${hitSize / -2}px`;
        button.style.marginTop = `${hitSize / -2}px`;
        button.innerHTML = `
          <span class="asset-hotspot-ping" aria-hidden="true"></span>
          <span class="asset-hotspot-core" aria-hidden="true"></span>
          <span class="hotspot-label">${hotspot.label || hotspot.title || ''}</span>
        `;
        button.addEventListener('click', event => {
          event.stopPropagation();
          openAssetModal(hotspot);
        });
      } else {
        button.innerHTML = `
          <span class="hotspot-ring" aria-hidden="true"></span>
          <span class="hotspot-core" aria-hidden="true">
            <span class="hotspot-arrow"></span>
          </span>
          <span class="hotspot-label">${hotspot.label || SCENES[hotspot.targetScene]?.name || ''}</span>
        `;
        button.addEventListener('click', event => {
          event.stopPropagation();
          loadScene(hotspot.targetScene, true);
        });
      }

      hotspotLayer.appendChild(button);
      hotspotElements.push({ button, hotspot, kind: group.kind });
    });
  });
}

function updateHotspots() {
  if (!hotspotElements.length) return;

  hotspotElements.forEach(({ button, hotspot, kind }) => {
    const pos = projectToScreen(hotspot.yaw, hotspot.pitch);
    if (!pos) {
      button.classList.remove('visible');
      return;
    }

    if (kind === 'asset') {
      const scale = Math.max(0.85, Math.min(1.15, 1 / pos.depth + 0.25));
      button.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale})`;
    } else {
      const depthScale = Math.max(0.72, Math.min(1.18, 1 / pos.depth));
      const squash = Math.max(0.42, Math.min(0.72, 0.5 + pos.depth * 0.08));
      button.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${depthScale}, ${depthScale * squash})`;
    }

    button.classList.add('visible');
  });
}

function setAssetImage(index) {
  if (!currentAsset?.images?.length) {
    assetImage.classList.add('hidden');
    assetEmptyState.classList.remove('hidden');
    assetPrev.disabled = true;
    assetNext.disabled = true;
    return;
  }

  currentAssetImageIndex = (index + currentAsset.images.length) % currentAsset.images.length;
  assetEmptyState.classList.add('hidden');
  assetImage.classList.remove('hidden');
  assetImage.src = currentAsset.images[currentAssetImageIndex];
  assetImage.alt = `${currentAsset.title} render ${currentAssetImageIndex + 1}`;
  const canNavigate = currentAsset.images.length > 1;
  assetPrev.disabled = !canNavigate;
  assetNext.disabled = !canNavigate;
  Array.from(assetDots.children).forEach((dot, dotIndex) => {
    dot.classList.toggle('active', dotIndex === currentAssetImageIndex);
    dot.setAttribute('aria-current', dotIndex === currentAssetImageIndex ? 'true' : 'false');
  });
  Array.from(assetThumbs.children).forEach((thumb, thumbIndex) => {
    thumb.classList.toggle('active', thumbIndex === currentAssetImageIndex);
  });
}

function renderAssetDots() {
  assetDots.innerHTML = '';

  if (!currentAsset?.images?.length) return;

  currentAsset.images.forEach((_, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'asset-dot';
    dot.setAttribute('aria-label', `Show ${currentAsset.title} image ${index + 1}`);
    dot.addEventListener('click', () => setAssetImage(index));
    assetDots.appendChild(dot);
  });
}

function renderAssetThumbs() {
  assetThumbs.innerHTML = '';

  if (!currentAsset?.images?.length) return;

  currentAsset.images.forEach((src, index) => {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'asset-thumb';
    thumb.setAttribute('aria-label', `Show ${currentAsset.title} image ${index + 1}`);
    thumb.innerHTML = `<img src="${src}" alt="${currentAsset.title} thumbnail ${index + 1}" />`;
    thumb.addEventListener('click', () => setAssetImage(index));
    assetThumbs.appendChild(thumb);
  });
}

function openAssetModal(asset) {
  currentAsset = asset;
  currentAssetImageIndex = 0;
  assetTitle.textContent = asset.title || asset.label || 'Asset details';
  assetKicker.textContent = asset.category || 'Asset details';
  assetDescription.textContent = asset.description || '';
  renderAssetDots();
  renderAssetThumbs();
  setAssetImage(0);
  assetModal.classList.remove('hidden');
  assetModal.setAttribute('aria-hidden', 'false');
  viewerEl.classList.add('modal-open');
  stopAutoRotate();
  needsRender = true;
}

function closeAssetModal() {
  currentAsset = null;
  assetModal.classList.add('hidden');
  assetModal.setAttribute('aria-hidden', 'true');
  viewerEl.classList.remove('modal-open');
  assetPrev.disabled = true;
  assetNext.disabled = true;
  assetImage.removeAttribute('src');
  assetImage.classList.remove('hidden');
  assetEmptyState.classList.add('hidden');
  assetDots.innerHTML = '';
  assetThumbs.innerHTML = '';
}

assetCloseBtn.addEventListener('click', closeAssetModal);
assetBackdrop.addEventListener('click', closeAssetModal);
assetPrev.addEventListener('click', () => setAssetImage(currentAssetImageIndex - 1));
assetNext.addEventListener('click', () => setAssetImage(currentAssetImageIndex + 1));

assetGalleryStage.addEventListener('touchstart', event => {
  if (!currentAsset?.images?.length || event.touches.length !== 1) return;
  galleryTouchStartX = event.touches[0].clientX;
  galleryTouchDeltaX = 0;
}, { passive: true });

assetGalleryStage.addEventListener('touchmove', event => {
  if (galleryTouchStartX === null || event.touches.length !== 1) return;
  galleryTouchDeltaX = event.touches[0].clientX - galleryTouchStartX;
}, { passive: true });

assetGalleryStage.addEventListener('touchend', () => {
  if (galleryTouchStartX === null || !currentAsset?.images?.length) return;
  if (Math.abs(galleryTouchDeltaX) > 40) {
    setAssetImage(currentAssetImageIndex + (galleryTouchDeltaX < 0 ? 1 : -1));
  }
  galleryTouchStartX = null;
  galleryTouchDeltaX = 0;
});

mobileSceneToggle.addEventListener('click', () => {
  setMobileScenePanel(!isMobileScenePanelOpen);
});

mobileSceneClose.addEventListener('click', () => {
  setMobileScenePanel(false);
});

function renderSpherical() {
  if (!sourcePixels || !currentImage?.complete || !currentImage.naturalWidth) return;

  const yawDelta = normalizeAngle(targetYaw - yaw);
  yaw += yawDelta * 0.1;
  pitch += (targetPitch - pitch) * 0.1;
  pitch = Math.max(-75, Math.min(75, pitch));

  const renderKey = `${Math.round(yaw * 10)}:${Math.round(pitch * 10)}:${Math.round(fov * 10)}:${outputWidth}:${outputHeight}`;
  if (renderKey !== lastRenderKey) {
    updateRayCache();
    const imgW = sourceWidth;
    const imgH = sourceHeight;
    const dest = renderImageData.data;

    const yawRad = yaw * Math.PI / 180;
    const pitchRad = pitch * Math.PI / 180;
    const cosYaw = Math.cos(yawRad);
    const sinYaw = Math.sin(yawRad);
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);

    let index = 0;
    for (let rayIndex = 0; rayIndex < rayDirections.length; rayIndex += 3) {
      const dx = rayDirections[rayIndex];
      const dy = rayDirections[rayIndex + 1];
      const dz = rayDirections[rayIndex + 2];
      const pDy = dy * cosPitch - dz * sinPitch;
      const pDz = dy * sinPitch + dz * cosPitch;
      const wDx = dx * cosYaw + pDz * sinYaw;
      const wDy = pDy;
      const wDz = -dx * sinYaw + pDz * cosYaw;
      const lon = Math.atan2(wDx, wDz);
      const lat = Math.asin(Math.max(-1, Math.min(1, wDy)));
      const srcX = Math.floor((((lon / (2 * Math.PI)) + 0.5 + 1) % 1) * imgW);
      const srcY = Math.max(0, Math.min(imgH - 1, Math.floor((0.5 - lat / Math.PI) * imgH)));
      const sourceIndex = (srcY * imgW + srcX) * 4;

      dest[index] = sourcePixels[sourceIndex];
      dest[index + 1] = sourcePixels[sourceIndex + 1];
      dest[index + 2] = sourcePixels[sourceIndex + 2];
      dest[index + 3] = 255;
      index += 4;
    }

    renderCtx.putImageData(renderImageData, 0, 0);
    lastRenderKey = renderKey;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(renderCanvas, 0, 0, canvas.width, canvas.height);
}

function loop(now = 0) {
  const dt = Math.min(now - lastFrameTime, 50);
  lastFrameTime = now;

  if (autoRotate && dt > 0 && assetModal.classList.contains('hidden')) {
    targetYaw += dt * 0.01;
    needsRender = true;
  }

  if (transitioning) {
    transitionAlpha += transitionDir * TRANS_SPEED;

    if (transitionDir === 1 && transitionAlpha >= 1) {
      transitionAlpha = 1;
      transitionDir = -1;
      _applySceneSwap(transitionTarget);
    } else if (transitionDir === -1 && transitionAlpha <= 0) {
      transitionAlpha = 0;
      transitioning = false;
    }

    needsRender = true;
  }

  if (needsRender) {
    renderSpherical();
    updateHotspots();

    if (transitioning && transitionAlpha > 0) {
      const scale = 1 + transitionAlpha * 0.08;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
      ctx.fillStyle = `rgba(255,255,255,${transitionAlpha * 0.85})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    needsRender =
      transitioning ||
      Math.abs(normalizeAngle(targetYaw - yaw)) > 0.05 ||
      Math.abs(targetPitch - pitch) > 0.05 ||
      autoRotate;
  }

  requestAnimationFrame(loop);
}

function loadScene(index, useMotionBlur = false) {
  if (index < 0 || index >= SCENES.length || index === currentScene) return;
  closeAssetModal();
  setMobileScenePanel(false);

  if (useMotionBlur) {
    transitioning = true;
    transitionAlpha = 0;
    transitionDir = 1;
    transitionTarget = index;
    needsRender = true;
    return;
  }

  const flash = document.getElementById('flash');
  if (flash) {
    flash.classList.add('show');
    setTimeout(() => {
      _applySceneSwap(index);
      flash.classList.remove('show');
    }, 280);
  } else {
    _applySceneSwap(index);
  }
}

function _applySceneSwap(index) {
  currentScene = index;
  updateLabel(index);
  updateCounter(index);
  updateMenu(index);
  updateDots(index);
  yaw = 0;
  pitch = 0;
  targetYaw = 0;
  targetPitch = 0;
  fov = 120;
  buildHotspots(SCENES[index]);
  needsRender = true;

  function applyImage(img) {
    currentImage = img;
    document.getElementById('loading').classList.add('hidden');

    try {
      prepareSourceImage(img);
    } catch (error) {
      console.error('Canvas security error — open via a local server, not file://', error);
      const loadingEl = document.getElementById('loading');
      loadingEl.innerHTML =
        '<p style="color:#c9a96e;font-family:sans-serif;padding:2rem;text-align:center;line-height:1.8">' +
        '&#9888; Panorama blocked by browser security.<br><br>' +
        'Open this folder with a local server:<br>' +
        '<code style="background:#111;padding:4px 8px;border-radius:4px">npx serve .</code>' +
        '&nbsp; or &nbsp;' +
        '<code style="background:#111;padding:4px 8px;border-radius:4px">python3 -m http.server 8080</code>' +
        '</p>';
      loadingEl.classList.remove('hidden');
    }
  }

  if (imageCache[index]) {
    applyImage(imageCache[index]);
  } else {
    const img = new Image();
    img.onload = () => {
      imageCache[index] = img;
      applyImage(img);
    };
    img.onerror = () => {
      document.getElementById('loading').classList.add('hidden');
      console.warn('Could not load:', SCENES[index].file);
    };
    img.src = SCENES[index].file;
  }

  [index - 1, index + 1].forEach(neighbourIndex => {
    if (neighbourIndex >= 0 && neighbourIndex < SCENES.length && !imageCache[neighbourIndex]) {
      const preloadImg = new Image();
      preloadImg.onload = () => {
        imageCache[neighbourIndex] = preloadImg;
      };
      preloadImg.src = SCENES[neighbourIndex].file;
    }
  });
}

function updateLabel(index) {
  document.getElementById('label-num').textContent = String(index + 1).padStart(2, '0');
  document.getElementById('label-name').textContent = SCENES[index].name;
  const label = document.getElementById('scene-label');
  label.classList.remove('hidden');
  setTimeout(() => label.classList.add('hidden'), 2800);
}

function updateCounter(index) {
  document.getElementById('counter').textContent =
    `${String(index + 1).padStart(2, '0')} / ${String(SCENES.length).padStart(2, '0')}`;
  mobileSceneCurrent.textContent = SCENES[index].name;
}

function updateMenu(index) {
  document.querySelectorAll('.menu-item').forEach((el, itemIndex) => {
    el.classList.toggle('active', itemIndex === index);
  });
  document.querySelectorAll('.mobile-menu-item').forEach((el, itemIndex) => {
    el.classList.toggle('active', itemIndex === index);
  });
}

function updateDots(index) {
  document.querySelectorAll('.scene-dot').forEach((el, itemIndex) => {
    el.classList.toggle('active', itemIndex === index);
  });
}

function goNext() {
  loadScene((currentScene + 1) % SCENES.length);
}

function goPrev() {
  loadScene((currentScene - 1 + SCENES.length) % SCENES.length);
}

document.getElementById('btn-next').addEventListener('click', goNext);
document.getElementById('btn-prev').addEventListener('click', goPrev);

viewerEl.addEventListener('mousemove', event => {
  viewerEl.style.cursor = isDragging ? 'grabbing' : 'grab';
  if (!isDragging || !assetModal.classList.contains('hidden')) return;

  enterInteractionMode();
  targetYaw += (event.clientX - lastX) * 0.3;
  targetPitch -= (event.clientY - lastY) * 0.3;
  targetPitch = Math.max(-75, Math.min(75, targetPitch));
  lastX = event.clientX;
  lastY = event.clientY;
  needsRender = true;
});

viewerEl.addEventListener('mousedown', event => {
  if (assetModal.classList.contains('hidden') === false || event.target.closest('.hotspot-button')) return;
  isDragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  enterInteractionMode();
  stopAutoRotate();
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  viewerEl.style.cursor = assetModal.classList.contains('hidden') ? 'grab' : 'default';
});

viewerEl.addEventListener('touchstart', event => {
  if (event.touches.length !== 1) return;
  if (assetModal.classList.contains('hidden') === false || event.target.closest('.hotspot-button')) return;

  isDragging = true;
  lastX = event.touches[0].clientX;
  lastY = event.touches[0].clientY;
  enterInteractionMode();
  stopAutoRotate();
}, { passive: true });

viewerEl.addEventListener('touchmove', event => {
  if (!isDragging || event.touches.length !== 1 || !assetModal.classList.contains('hidden')) return;

  event.preventDefault();
  enterInteractionMode();
  const dx = event.touches[0].clientX - lastX;
  const dy = event.touches[0].clientY - lastY;
  // On touch, move the panorama opposite the finger so the scene follows natural swipe expectations.
  targetYaw -= dx * TOUCH_YAW_SENSITIVITY;
  targetPitch -= dy * TOUCH_PITCH_SENSITIVITY;
  targetPitch = Math.max(-75, Math.min(75, targetPitch));
  lastX = event.touches[0].clientX;
  lastY = event.touches[0].clientY;
  needsRender = true;
}, { passive: false });

viewerEl.addEventListener('touchend', () => {
  isDragging = false;
});

viewerEl.addEventListener('wheel', event => {
  if (!assetModal.classList.contains('hidden')) return;
  fov = Math.max(30, Math.min(120, fov + event.deltaY * 0.05));
  enterInteractionMode();
  stopAutoRotate();
  needsRender = true;
}, { passive: true });

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !assetModal.classList.contains('hidden')) {
    closeAssetModal();
    return;
  }

  switch (event.key) {
    case 'ArrowRight':
      if (!assetModal.classList.contains('hidden')) setAssetImage(currentAssetImageIndex + 1);
      else goNext();
      break;
    case 'ArrowLeft':
      if (!assetModal.classList.contains('hidden')) setAssetImage(currentAssetImageIndex - 1);
      else goPrev();
      break;
    case 'ArrowUp':
      if (!assetModal.classList.contains('hidden')) break;
      enterInteractionMode();
      targetPitch -= 15;
      stopAutoRotate();
      needsRender = true;
      break;
    case 'ArrowDown':
      if (!assetModal.classList.contains('hidden')) break;
      enterInteractionMode();
      targetPitch += 15;
      stopAutoRotate();
      needsRender = true;
      break;
    case '+':
    case '=':
      if (!assetModal.classList.contains('hidden')) break;
      enterInteractionMode();
      fov = Math.max(30, fov - 10);
      needsRender = true;
      break;
    case '-':
      if (!assetModal.classList.contains('hidden')) break;
      enterInteractionMode();
      fov = Math.min(120, fov + 10);
      needsRender = true;
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
  }
});

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}

document.getElementById('fs-btn').addEventListener('click', toggleFullscreen);

setInterval(() => {
  if (window.DEBUG_YAW) console.log(`yaw: ${Math.round(yaw)} | pitch: ${Math.round(pitch)}`);
}, 500);

const menuEl = document.getElementById('scene-menu');
const stripEl = document.getElementById('scene-strip');

SCENES.forEach((scene, index) => {
  const section = getSceneSection(scene);
  const prevScene = SCENES[index - 1];
  const prevSection = prevScene ? getSceneSection(prevScene) : null;

  if (section !== prevSection) {
    const menuHeader = document.createElement('div');
    menuHeader.className = 'scene-menu-section';
    menuHeader.textContent = section;
    menuEl.appendChild(menuHeader);

    const mobileHeader = document.createElement('div');
    mobileHeader.className = 'mobile-scene-section';
    mobileHeader.textContent = section;
    mobileSceneList.appendChild(mobileHeader);
  }

  const item = document.createElement('button');
  item.className = `menu-item${index === 0 ? ' active' : ''}`;
  item.innerHTML = `<span class="dot"></span>${String(index + 1).padStart(2, '0')}. ${scene.name}`;
  item.addEventListener('click', () => loadScene(index));
  menuEl.appendChild(item);

  const mobileItem = document.createElement('button');
  mobileItem.className = `mobile-menu-item${index === 0 ? ' active' : ''}`;
  mobileItem.type = 'button';
  mobileItem.innerHTML = `
    <span class="mobile-menu-index">${String(index + 1).padStart(2, '0')}</span>
    <span class="mobile-menu-copy">
      <span class="mobile-menu-title">${scene.name}</span>
      <span class="mobile-menu-type">${section}</span>
    </span>
  `;
  mobileItem.addEventListener('click', () => loadScene(index));
  mobileSceneList.appendChild(mobileItem);

  const dot = document.createElement('div');
  dot.className = `scene-dot${index === 0 ? ' active' : ''}`;
  dot.title = scene.name;
  dot.addEventListener('click', () => loadScene(index));
  stripEl.appendChild(dot);
});

loadScene(0);
requestAnimationFrame(loop);
