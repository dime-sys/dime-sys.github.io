// Smooth reveal on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.feat-card, .step, .pain-card, .mp-card, .alert-card, .gov-visual, .funnel-box, .rules-visual, .mock-browser').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity 0.55s ease, transform 0.55s ease';
  observer.observe(el);
});

// Carousel logic
const tabs  = document.querySelectorAll('.ctab');
const slides = document.querySelectorAll('.cslide');
const dots  = document.querySelectorAll('.cdot');
let current = 0;

function goTo(idx) {
  slides[current].classList.remove('active');
  tabs[current].classList.remove('active');
  dots[current].classList.remove('active');
  current = (idx + slides.length) % slides.length;
  slides[current].classList.add('active');
  tabs[current].classList.add('active');
  dots[current].classList.add('active');
}

tabs.forEach(t => t.addEventListener('click', () => goTo(+t.dataset.idx)));
dots.forEach((d, i) => d.addEventListener('click', () => goTo(i)));
document.getElementById('prevBtn').addEventListener('click', () => goTo(current - 1));
document.getElementById('nextBtn').addEventListener('click', () => goTo(current + 1));

// Auto-advance every 30s
setInterval(() => goTo(current + 1), 30000);

// ── Demo modal ────────────────────────────────────────────────
const overlay   = document.getElementById('demoModal');
const form      = document.getElementById('demoForm');
const success   = document.getElementById('demoSuccess');
const submitBtn = document.getElementById('dmSubmitBtn');
const requiredFields = ['dm-name', 'dm-company', 'dm-email'];

function openModal() {
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
  submitBtn.disabled = false;
  submitBtn.textContent = 'Enviar solicitud →';
  requiredFields.forEach(id =>
    document.getElementById(id).style.borderColor = ''
  );
}

document.querySelectorAll('.open-demo-modal').forEach(btn =>
  btn.addEventListener('click', openModal)
);
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('closeSuccess').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('dm-email');
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
  let valid = true;
  requiredFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el.value.trim() || (el === email && !emailOk)) {
      el.style.borderColor = 'rgba(239,68,68,0.7)';
      valid = false;
    }
  });
  if (!valid) return;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando...';
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: new FormData(form)
    });
    if (res.ok) {
      form.hidden = true;
      success.hidden = false;
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar solicitud →';
      alert('Hubo un error al enviar. Por favor inténtalo de nuevo.');
    }
  } catch {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar solicitud →';
    alert('Error de conexión. Por favor inténtalo de nuevo.');
  }
});

requiredFields.forEach(id =>
  document.getElementById(id).addEventListener('input', function() {
    if (this.value.trim()) this.style.borderColor = '';
  })
);
