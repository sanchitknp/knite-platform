/* ============================================================
   Knite — Shared Header (nav.js)
   Drop into any page with:
     <script src="/nav.js" defer></script>
   Optional anchor:
     <div id="knite-nav"></div>   (else injects at <body> top)
   ============================================================ */
(function () {
  const CART_KEY = 'knite_cart_v1';

  // ── CSS (scoped under .kn-nav-*) ───────────────────────────
  const css = `
  body { padding-top: 68px; }

  .kn-nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
    background: rgba(10,22,40,0.95);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    padding: 0 5%; height: 68px;
    display: flex; align-items: center; justify-content: space-between;
    transition: background 0.3s, box-shadow 0.3s;
    font-family: 'Inter', system-ui, sans-serif;
  }
  .kn-nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #fff; }
  .kn-nav-logo svg { width: 36px; height: 36px; }
  .kn-nav-brand {
    font-family: 'Poppins', sans-serif; font-size: 22px; font-weight: 700;
    letter-spacing: 3px; text-transform: uppercase; color: #fff;
  }
  .kn-nav-brand .dot { color: #00b4d8; }

  .kn-nav-links {
    display: flex; align-items: center; gap: 24px;
    list-style: none; margin: 0; padding: 0;
  }
  .kn-nav-links li { list-style: none; }
  .kn-nav-links a {
    color: rgba(255,255,255,0.78); text-decoration: none;
    font-size: 14px; font-weight: 500; letter-spacing: 0.3px;
    transition: color 0.2s; font-family: 'Inter', sans-serif;
  }
  .kn-nav-links a:hover { color: #00b4d8; }
  .kn-nav-links a.kn-shop-link { color: #00b4d8; font-weight: 600; }

  .kn-cta {
    background: #00b4d8; color: #0a1628 !important;
    padding: 9px 22px; border-radius: 50px;
    font-weight: 600 !important; font-size: 13px !important;
  }
  .kn-cta:hover { background: #fff; }

  .kn-cart-btn, .kn-account-btn {
    background: rgba(255,255,255,0.06);
    padding: 7px 14px; border-radius: 8px;
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 13px !important; font-weight: 500;
    border: 1px solid rgba(255,255,255,0.10);
    color: #fff !important; cursor: pointer;
  }
  .kn-cart-btn:hover, .kn-account-btn:hover { background: rgba(255,255,255,0.12); color: #fff !important; }

  /* Account dropdown (logged-in only) */
  .kn-acct { position: relative; }
  .kn-acct-menu {
    position: absolute; top: calc(100% + 12px); right: 0;
    background: #fff; min-width: 200px; padding: 8px;
    border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.04);
    list-style: none; margin: 0; z-index: 1100;
    opacity: 0; visibility: hidden; transform: translateY(-6px);
    transition: opacity .18s, transform .18s, visibility .18s;
  }
  /* Tiny pointer arrow connecting menu to chip */
  .kn-acct-menu::before {
    content: ''; position: absolute; top: -6px; right: 22px;
    width: 12px; height: 12px; background: #fff;
    transform: rotate(45deg);
    box-shadow: -1px -1px 0 rgba(0,0,0,0.04);
  }
  .kn-acct.open .kn-acct-menu,
  .kn-acct:focus-within .kn-acct-menu { opacity: 1; visibility: visible; transform: none; }
  /* Only enable hover-open on devices that truly support hover (desktop with mouse) */
  @media (hover: hover) and (pointer: fine) {
    .kn-acct:hover .kn-acct-menu { opacity: 1; visibility: visible; transform: none; }
  }
  /* Invisible bridge so hover doesn't drop in the gap between chip and menu */
  .kn-acct::after {
    content: ''; position: absolute; top: 100%; right: 0;
    width: 100%; height: 14px;
  }
  /* Tablet/small-width: anchor dropdown to viewport right edge instead of chip,
     so it doesn't visually overlap the neighbouring nav icons */
  @media (max-width: 1100px) {
    .kn-acct-menu { right: -8px; }
  }
  .kn-acct-menu li { list-style: none; }
  .kn-acct-menu a {
    display: block; padding: 10px 14px; border-radius: 8px;
    color: #0a1628 !important; font-size: 14px; font-weight: 500;
    text-decoration: none;
  }
  .kn-acct-menu a:hover { background: #f1f5f9; }
  .kn-acct-divider { height: 1px; background: #e2e8f0; margin: 6px 4px; }
  /* "Cart" word: hidden by default, revealed on hover */
  .kn-cart-text {
    max-width: 0; overflow: hidden; white-space: nowrap;
    opacity: 0; transition: max-width 0.25s ease, opacity 0.2s ease, margin 0.25s ease;
    display: inline-block; margin: 0;
  }
  .kn-cart-btn:hover .kn-cart-text,
  .kn-cart-btn:focus-visible .kn-cart-text {
    max-width: 60px; opacity: 1; margin: 0 2px;
  }
  /* Account chip: icon only when logged out, "Hello <Name> ▾" when logged in */
  .kn-account-text { display: none !important; }
  .kn-acct-greet { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; white-space: nowrap; }
  .kn-acct-greet strong { font-weight: 700; color: #fff; }
  .kn-acct-chev { transition: transform 0.2s; }
  .kn-acct:hover .kn-acct-chev,
  .kn-acct.open .kn-acct-chev { transform: rotate(180deg); }
  .kn-cart-count {
    background: #00b4d8; color: #0a1628;
    font-weight: 700; border-radius: 99px;
    padding: 1px 7px; font-size: 11px; min-width: 20px; text-align: center;
  }

  /* "More" dropdown */
  .kn-drop { position: relative; }
  .kn-drop > button {
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.78); font-size: 14px; font-weight: 500;
    letter-spacing: 0.3px;
    display: inline-flex; align-items: center; gap: 4px;
    font-family: 'Inter', sans-serif; padding: 0; transition: color 0.2s;
  }
  .kn-drop:hover > button, .kn-drop.open > button { color: #00b4d8; }
  .kn-drop > button svg { transition: transform 0.2s; }
  .kn-drop:hover > button svg, .kn-drop.open > button svg { transform: rotate(180deg); }
  .kn-drop ul {
    position: absolute; top: calc(100% + 14px); right: 0;
    background: #fff; min-width: 180px;
    border-radius: 12px; box-shadow: 0 14px 40px rgba(0,0,0,0.14);
    padding: 8px; opacity: 0; visibility: hidden; transform: translateY(-6px);
    transition: opacity .18s, transform .18s, visibility .18s;
    list-style: none; z-index: 1001; margin: 0;
  }
  .kn-drop:hover ul, .kn-drop:focus-within ul, .kn-drop.open ul {
    opacity: 1; visibility: visible; transform: none;
  }
  .kn-drop ul a {
    display: block; padding: 10px 14px; border-radius: 8px;
    color: #0a1628 !important; font-size: 14px; font-weight: 500;
  }
  .kn-drop ul a:hover { background: #f1f5f9; color: #0a1628 !important; }

  .kn-ham { display: none; cursor: pointer; flex-direction: column; gap: 5px; }
  .kn-ham span { width: 24px; height: 2px; background: #fff; border-radius: 2px; transition: 0.3s; }

  /* Mobile */
  @media (max-width: 900px) {
    .kn-nav-links { display: none; }
    .kn-ham { display: flex; }
    .kn-nav-links.open {
      display: flex; flex-direction: column;
      position: fixed; top: 68px; left: 0; right: 0;
      background: rgba(10,22,40,0.98);
      padding: 24px; gap: 20px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      align-items: center; text-align: center;
      max-height: calc(100vh - 68px); overflow-y: auto;
    }
    .kn-drop > button { display: none; }
    .kn-drop ul {
      position: static; opacity: 1; visibility: visible; transform: none;
      background: transparent; box-shadow: none; padding: 0;
      display: flex; flex-direction: column; gap: 20px; min-width: 0;
      width: 100%; align-items: center; text-align: center;
    }
    .kn-drop ul li { width: 100%; text-align: center; }
    .kn-drop ul a {
      color: rgba(255,255,255,0.78) !important;
      padding: 0; background: transparent !important;
    }
    .kn-drop {
      display: flex; flex-direction: column; gap: 20px;
      align-items: center; width: 100%; text-align: center;
    }
  }`;

  // ── HTML ───────────────────────────────────────────────────
  const html = `
  <nav class="kn-nav" id="kniteNav">
    <a href="/" class="kn-nav-logo" aria-label="Knite home">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="kn-navBg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#0f2b4a"/><stop offset="100%" stop-color="#020617"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="32" fill="url(#kn-navBg)"/>
        <circle cx="32" cy="32" r="28" fill="none" stroke="#00b4d8" stroke-width="0.9" stroke-opacity="0.55"/>
        <text x="32" y="42" text-anchor="middle" font-family="Poppins,Inter,Helvetica,Arial,sans-serif" font-weight="800" font-size="26" letter-spacing="-2" fill="#ffffff">KN</text>
      </svg>
      <span class="kn-nav-brand">KNITE<span class="dot">.</span></span>
    </a>

    <ul class="kn-nav-links" id="kniteNavLinks">
      <li><a href="/#products">Products</a></li>
      <li><a href="/blog.html">Blogs</a></li>
      <li><a href="/#about">About</a></li>
      <li class="kn-drop" id="kniteDrop">
        <button type="button" aria-haspopup="true" aria-expanded="false">
          More
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 3l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <ul>
          <li><a href="/#features">Why Knite</a></li>
          <li><a href="/#coverage">Coverage</a></li>
          <li><a href="/#reviews">Reviews</a></li>
          <li><a href="/#faq">FAQ</a></li>
        </ul>
      </li>
      <li id="kniteCartLi"><a href="/cart.html" class="kn-cart-btn" aria-label="Cart">🛒 <span class="kn-cart-text">Cart</span> <span class="kn-cart-count" id="kniteCartCount">0</span></a></li>
      <li class="kn-acct" id="kniteAcct">
        <a href="/login.html" class="kn-account-btn" id="kniteAccountLink" aria-label="Sign in">
          <span class="kn-acct-icon" id="kniteAccountIcon">👤</span>
          <span class="kn-acct-greet" id="kniteAccountGreet" style="display:none">
            Hello <strong id="kniteAccountName">there</strong>
            <svg class="kn-acct-chev" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1 3l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </a>
        <ul class="kn-acct-menu" id="kniteAcctMenu" style="display:none">
          <li><a href="/account.html#orders">📦 My Orders</a></li>
          <li><a href="/account.html#addresses">📍 Addresses</a></li>
          <li><a href="/account.html#profile">👤 Profile</a></li>
          <li class="kn-acct-divider"></li>
          <li><a href="#" onclick="event.preventDefault();kniteLogout()" style="color:#dc2626">↪ Sign out</a></li>
        </ul>
      </li>
      <li><a href="/#feedback" class="kn-cta">Get a Quote</a></li>
    </ul>

    <div class="kn-ham" id="kniteHam" aria-label="Toggle menu" role="button" tabindex="0"><span></span><span></span><span></span></div>
  </nav>`;

  // Inject CSS
  const style = document.createElement('style');
  style.id = 'knite-nav-css';
  style.textContent = css;
  document.head.appendChild(style);

  // Inject HTML (replace placeholder if present, else prepend to body)
  function insert() {
    const slot = document.getElementById('knite-nav');
    if (slot) slot.outerHTML = html;
    else document.body.insertAdjacentHTML('afterbegin', html);
    wireUp();
  }
  if (document.body) insert();
  else document.addEventListener('DOMContentLoaded', insert);

  function wireUp() {
    // Cart count
    function updateCart() {
      try {
        const cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
        const total = cart.reduce((s, i) => s + (i.quantity || 0), 0);
        const el = document.getElementById('kniteCartCount');
        if (el) { el.textContent = total; el.style.display = total > 0 ? '' : 'none'; }
      } catch (e) {}
    }
    updateCart();
    window.addEventListener('storage', updateCart);
    window.addEventListener('focus', updateCart);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateCart(); });
    // Expose globally so pages can call after cart mutations
    window.kniteUpdateCart = updateCart;

    // Bulletproof: wrap localStorage so ANY write to the cart key updates the badge.
    // Works in same-tab where the native 'storage' event would not fire.
    if (!localStorage.__kniteWrapped) {
      const _set = localStorage.setItem.bind(localStorage);
      const _rem = localStorage.removeItem.bind(localStorage);
      const _clr = localStorage.clear.bind(localStorage);
      localStorage.setItem = function (k, v) {
        _set(k, v);
        if (k === CART_KEY) updateCart();
      };
      localStorage.removeItem = function (k) {
        _rem(k);
        if (k === CART_KEY) updateCart();
      };
      localStorage.clear = function () { _clr(); updateCart(); };
      Object.defineProperty(localStorage, '__kniteWrapped', { value: true, writable: false });
    }

    // Auth chip + account dropdown
    fetch('/api/shop/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const link   = document.getElementById('kniteAccountLink');
        const icon   = document.getElementById('kniteAccountIcon');
        const greet  = document.getElementById('kniteAccountGreet');
        const nameEl = document.getElementById('kniteAccountName');
        const menu   = document.getElementById('kniteAcctMenu');
        const acct   = document.getElementById('kniteAcct');
        if (d && d.logged_in) {
          const firstName = (d.customer && d.customer.name) ? d.customer.name.split(' ')[0] : 'there';
          if (nameEl) nameEl.textContent = firstName;
          if (icon)   icon.style.display = 'none';
          if (greet)  greet.style.display = '';
          if (link) {
            link.href = '#';
            link.setAttribute('aria-label', 'Account menu');
            link.onclick = (e) => { e.preventDefault(); toggleAcct(); };
          }
          if (menu) menu.style.display = '';
          document.addEventListener('click', (e) => {
            if (acct && !acct.contains(e.target)) acct.classList.remove('open');
          });
        } else {
          if (icon)  icon.style.display = '';
          if (greet) greet.style.display = 'none';
          if (menu)  menu.style.display = 'none';
        }
      })
      .catch(() => {});
    function toggleAcct() {
      const acct = document.getElementById('kniteAcct');
      if (acct) acct.classList.toggle('open');
    }
    window.kniteLogout = async function () {
      try {
        await fetch('/api/shop/auth/logout', { method: 'POST', credentials: 'include' });
      } catch {}
      window.location.replace('/');
    };

    // Hamburger
    const ham = document.getElementById('kniteHam');
    const links = document.getElementById('kniteNavLinks');
    if (ham && links) {
      const toggle = () => {
        const open = links.classList.toggle('open');
        ham.style.gap = open ? '0' : '5px';
      };
      ham.addEventListener('click', toggle);
      ham.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      // Close mobile menu when a link is clicked
      links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));
    }

    // "More" dropdown
    const drop = document.getElementById('kniteDrop');
    if (drop) {
      const btn = drop.querySelector('button');
      btn && btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = drop.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', (e) => {
        if (!drop.contains(e.target)) {
          drop.classList.remove('open');
          if (btn) btn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Scroll background
    window.addEventListener('scroll', () => {
      const nav = document.getElementById('kniteNav');
      if (!nav) return;
      if (window.scrollY > 40) {
        nav.style.background = 'rgba(10,22,40,0.98)';
        nav.style.boxShadow = '0 2px 30px rgba(0,0,0,0.3)';
      } else {
        nav.style.background = 'rgba(10,22,40,0.95)';
        nav.style.boxShadow = 'none';
      }
    });
  }
})();
