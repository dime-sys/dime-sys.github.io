const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ── Tema claro/oscuro ─────────────────────────────────────────
// El script inline del <head> ya dejó data-theme puesto antes del primer paint.
const themeToggle = document.getElementById('themeToggle');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const systemLight = window.matchMedia('(prefers-color-scheme: light)');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeMeta.setAttribute('content', theme === 'light' ? '#f6f8fb' : '#050914');
  themeToggle.setAttribute('aria-label',
    theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro');
}
applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  applyTheme(next);
});

// Si el usuario no eligió tema manualmente, seguir los cambios del sistema
systemLight.addEventListener('change', e => {
  if (!localStorage.getItem('theme')) applyTheme(e.matches ? 'light' : 'dark');
});

// Smooth reveal on scroll (desactivado si el usuario prefiere menos movimiento)
if (!reducedMotion.matches) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const el = e.target;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        // Al terminar, se limpian los estilos inline para que la transición
        // del reveal (y su delay) no pise las transiciones de hover del CSS
        el.addEventListener('transitionend', function cleanup(ev) {
          if (ev.target !== el) return; // transitionend burbujea desde los hijos
          el.removeEventListener('transitionend', cleanup);
          el.style.transition = '';
          el.style.transitionDelay = '';
          el.style.opacity = '';
          el.style.transform = '';
        });
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.08 });

  // Stagger: los hermanos de un mismo grupo entran en cascada corta
  const groupCounts = new Map();
  document.querySelectorAll('.feat-card, .step, .pain-card, .mp-card, .alert-card, .gov-visual, .funnel-box, .rules-visual, .mock-browser').forEach(el => {
    const idx = groupCounts.get(el.parentElement) || 0;
    groupCounts.set(el.parentElement, idx + 1);
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s var(--ease-out), transform 0.5s var(--ease-out)';
    el.style.transitionDelay = Math.min(idx * 60, 240) + 'ms';
    observer.observe(el);
  });
}

// Contador animado en las cifras clave (una vez, al entrar en el viewport)
if (!reducedMotion.matches) {
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      statObserver.unobserve(entry.target);
      const el = entry.target;
      const match = el.textContent.trim().match(/^(\d+)(.*)$/);
      if (!match) return;
      const target = +match[1];
      const suffix = match[2];
      const start = performance.now();
      const duration = 900;
      function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cúbico
        el.textContent = Math.round(target * eased) + suffix;
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('.stat-value').forEach(el => statObserver.observe(el));
}

// ── Carousel ─────────────────────────────────────────────────
const tabs   = document.querySelectorAll('.ctab');
const slides = document.querySelectorAll('.cslide');
const dots   = document.querySelectorAll('.cdot');
const tablist = document.getElementById('carouselTabs');
const carousel = document.querySelector('.carousel-wrap');
let current = 0;

function goTo(idx, focusTab = false) {
  slides[current].classList.remove('active');
  tabs[current].classList.remove('active');
  tabs[current].setAttribute('aria-selected', 'false');
  tabs[current].setAttribute('tabindex', '-1');
  dots[current].classList.remove('active');
  current = (idx + slides.length) % slides.length;
  slides[current].classList.add('active');
  tabs[current].classList.add('active');
  tabs[current].setAttribute('aria-selected', 'true');
  tabs[current].removeAttribute('tabindex');
  dots[current].classList.add('active');
  if (focusTab) tabs[current].focus();
}

tabs.forEach(t => t.addEventListener('click', () => { stopAutoplay(); goTo(+t.dataset.idx); }));
dots.forEach((d, i) => d.addEventListener('click', () => { stopAutoplay(); goTo(i); }));
document.getElementById('prevBtn').addEventListener('click', () => { stopAutoplay(); goTo(current - 1); });
document.getElementById('nextBtn').addEventListener('click', () => { stopAutoplay(); goTo(current + 1); });

// Flechas del teclado sobre las pestañas
tablist.addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  e.preventDefault();
  stopAutoplay();
  goTo(current + (e.key === 'ArrowRight' ? 1 : -1), true);
});

// Auto-avance: solo sin reduced-motion; se pausa con hover/foco/pestaña oculta
// y se detiene de forma permanente en cuanto el usuario interactúa.
let autoplayId = null;
function startAutoplay() {
  if (reducedMotion.matches || autoplayId !== null) return;
  autoplayId = setInterval(() => goTo(current + 1), 30000);
}
function pauseAutoplay() {
  if (autoplayId !== null) { clearInterval(autoplayId); autoplayId = null; }
}
let autoplayStopped = false;
function stopAutoplay() { autoplayStopped = true; pauseAutoplay(); }

if (carousel) {
  carousel.addEventListener('mouseenter', pauseAutoplay);
  carousel.addEventListener('mouseleave', () => { if (!autoplayStopped) startAutoplay(); });
  carousel.addEventListener('focusin', pauseAutoplay);
  carousel.addEventListener('focusout', () => { if (!autoplayStopped) startAutoplay(); });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseAutoplay();
  else if (!autoplayStopped) startAutoplay();
});
startAutoplay();

// ── Demo modal ────────────────────────────────────────────────
const overlay   = document.getElementById('demoModal');
const modal     = overlay.querySelector('.demo-modal');
const form      = document.getElementById('demoForm');
const success   = document.getElementById('demoSuccess');
const submitBtn = document.getElementById('dmSubmitBtn');
const formStatus = document.getElementById('dmFormStatus');
const requiredFields = ['dm-name', 'dm-company', 'dm-email'];
let lastTrigger = null;

function setFieldError(id, hasError) {
  const el = document.getElementById(id);
  const msg = document.getElementById('err-' + id);
  el.setAttribute('aria-invalid', hasError ? 'true' : 'false');
  if (msg) msg.hidden = !hasError;
}

function openModal(e) {
  lastTrigger = e ? e.currentTarget : null;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.getElementById('dm-name').focus();
}
function closeModal() {
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  // Resetear form al cerrar para que se pueda volver a enviar
  form.reset();
  form.hidden = false;
  success.hidden = true;
  formStatus.hidden = true;
  submitBtn.disabled = false;
  submitBtn.textContent = 'Enviar solicitud →';
  requiredFields.forEach(id => setFieldError(id, false));
  if (lastTrigger) { lastTrigger.focus(); lastTrigger = null; }
}

document.querySelectorAll('.open-demo-modal').forEach(btn =>
  btn.addEventListener('click', openModal)
);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('closeSuccess').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => {
  if (!overlay.classList.contains('open')) return;
  if (e.key === 'Escape') { closeModal(); return; }
  // Focus trap: Tab no debe salir del modal mientras está abierto
  if (e.key === 'Tab') {
    const focusables = modal.querySelectorAll('button:not([disabled]), input:not([type="hidden"]):not([name="_gotcha"]), textarea, [href]');
    const visible = Array.from(focusables).filter(el => el.offsetParent !== null);
    if (!visible.length) return;
    const first = visible[0], last = visible[visible.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formStatus.hidden = true;
  const email = document.getElementById('dm-email');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
  let firstInvalid = null;
  requiredFields.forEach(id => {
    const el = document.getElementById(id);
    const bad = !el.value.trim() || (el === email && !emailOk);
    setFieldError(id, bad);
    if (bad && !firstInvalid) firstInvalid = el;
  });
  if (firstInvalid) { firstInvalid.focus(); return; }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando…';
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: new FormData(form)
    });
    if (res.ok) {
      form.hidden = true;
      success.hidden = false;
      document.getElementById('closeSuccess').focus();
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar solicitud →';
      formStatus.textContent = 'Hubo un error al enviar. Vuelve a intentarlo en unos segundos.';
      formStatus.hidden = false;
    }
  } catch {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar solicitud →';
    formStatus.textContent = 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.';
    formStatus.hidden = false;
  }
});

requiredFields.forEach(id =>
  document.getElementById(id).addEventListener('input', function() {
    if (this.value.trim()) setFieldError(id, false);
  })
);
