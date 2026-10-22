// ==UserScript==
// @name         Knite SAFE-T Auto-fill
// @namespace    knite.in
// @version      1.0
// @description  When a Knite admin opens the Amazon SAFE-T page, auto-fill the order id and let you check refund/claim eligibility in one click. Runs on Amazon's own page (same session), which is the only place browser security allows this.
// @match        https://sellercentral.amazon.in/safet-claims/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';

  // The Knite admin opens this page as: .../create-v2?...#knite_order=<ORDER_ID>
  function getOrderId() {
    const m = (location.hash || '').match(/knite_order=([0-9A-Za-z-]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  const orderId = getOrderId();
  if (!orderId) return;

  // React-friendly value setter (Amazon's form is a React app).
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function findOrderInput() {
    const list = Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea'));
    return list.find((el) => {
      const s = ((el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.name || '') + ' ' + (el.id || '')).toLowerCase();
      return s.includes('order');
    }) || list[0];
  }
  async function checkEligibility() {
    try {
      const res = await fetch('/safet-claims/disputemanagement/eligibility', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', accept: '*/*' },
        body: JSON.stringify({ entityType: 'orderId', entityId: orderId, claimType: 'SAFET' })
      });
      let data = null; try { data = await res.json(); } catch (e) {}
      return { ok: res.ok, status: res.status, data };
    } catch (e) { return { error: e.message }; }
  }

  // Floating helper panel.
  function panel() {
    if (document.getElementById('knite-safet')) return;
    const b = document.createElement('div');
    b.id = 'knite-safet';
    b.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;background:#0d1f2d;color:#e6edf3;border:1px solid #25d366;border-radius:10px;padding:12px 14px;font:13px/1.5 system-ui,Segoe UI,Arial;box-shadow:0 10px 30px rgba(0,0,0,.45);max-width:340px';
    b.innerHTML =
      '<div style="font-weight:700;color:#25d366">Knite SAFE-T</div>' +
      '<div style="margin:6px 0">Order: <b style="font-family:monospace">' + orderId + '</b></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '  <button id="k-fill" style="padding:6px 10px;background:#0d3320;border:1px solid #25d366;border-radius:6px;color:#25d366;cursor:pointer;font-weight:600">Fill order id</button>' +
      '  <button id="k-elig" style="padding:6px 10px;background:#13263a;border:1px solid #64b5f6;border-radius:6px;color:#64b5f6;cursor:pointer;font-weight:600">Check eligibility</button>' +
      '  <button id="k-x" style="padding:6px 8px;background:transparent;border:1px solid #3a4a5a;border-radius:6px;color:#8aa;cursor:pointer">✕</button>' +
      '</div>' +
      '<div id="k-res" style="margin-top:8px;color:#9fb3c8;word-break:break-word"></div>';
    document.body.appendChild(b);
    const res = b.querySelector('#k-res');
    b.querySelector('#k-fill').onclick = () => {
      const el = findOrderInput();
      if (el) { setValue(el, orderId); el.focus(); res.textContent = '✓ order id filled'; }
      else res.textContent = 'input not found — the id is copied, paste it manually';
    };
    b.querySelector('#k-elig').onclick = async () => {
      res.textContent = 'checking…';
      const r = await checkEligibility();
      if (r.error) { res.textContent = 'error: ' + r.error; return; }
      res.innerHTML = 'HTTP ' + r.status + ' · <span style="color:#e6edf3">' + (r.data ? JSON.stringify(r.data) : '(no body)') + '</span>';
    };
    b.querySelector('#k-x').onclick = () => b.remove();
  }

  (document.body ? panel : window.addEventListener.bind(window, 'DOMContentLoaded', panel))();

  // Best-effort auto-fill once the SPA renders the form (poll for ~10s).
  let tries = 0;
  const iv = setInterval(() => {
    const el = findOrderInput();
    if (el && !el.value) setValue(el, orderId);
    if (++tries > 20) clearInterval(iv);
  }, 500);
})();
