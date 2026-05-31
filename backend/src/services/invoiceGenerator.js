/**
 * Knite GST Invoice Generator
 * Builds an Indian GST-compliant tax invoice PDF using PDFKit.
 * Saves to /uploads/invoices/<invoice_number>.pdf and returns metadata.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('../db');

const SELLER = {
  name:      'Axios Enterprise LLP',
  brand:     'KNITE',
  address1:  '16, Basement, New Malviya Nagar Market',
  address2:  'New Delhi - 110017',
  state:     'Delhi',
  stateCode: '07',
  gstin:     process.env.SELLER_GSTIN || 'GSTIN-PENDING',
  llpin:     'ACX-2874',
  phone:     '+91 91960 68335',
  email:     'support@knite.in',
  website:   'https://knite.in',
};

// India state-code map (subset of common ones)
const STATE_CODES = {
  'Andhra Pradesh':'37','Arunachal Pradesh':'12','Assam':'18','Bihar':'10','Chhattisgarh':'22',
  'Delhi':'07','Goa':'30','Gujarat':'24','Haryana':'06','Himachal Pradesh':'02',
  'Jharkhand':'20','Karnataka':'29','Kerala':'32','Madhya Pradesh':'23','Maharashtra':'27',
  'Manipur':'14','Meghalaya':'17','Mizoram':'15','Nagaland':'13','Odisha':'21',
  'Punjab':'03','Rajasthan':'08','Sikkim':'11','Tamil Nadu':'33','Telangana':'36',
  'Tripura':'16','Uttar Pradesh':'09','Uttarakhand':'05','West Bengal':'19',
  'Chandigarh':'04','Jammu and Kashmir':'01','Ladakh':'38','Puducherry':'34',
};

const INVOICE_DIR = process.env.UPLOAD_DIR
  ? path.join(process.env.UPLOAD_DIR, 'invoices')
  : '/app/uploads/invoices';

if (!fs.existsSync(INVOICE_DIR)) fs.mkdirSync(INVOICE_DIR, { recursive: true });

// ─────────────────────────────────────────────
// Number → words (Indian numbering, for total in words)
// ─────────────────────────────────────────────
function numberToWords(num) {
  num = Math.round(num);
  if (num === 0) return 'Zero';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
    'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const inWords = n => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' '+ones[n%10] : '');
    return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' '+inWords(n%100) : '');
  };
  let out = '';
  const crore = Math.floor(num / 10000000);   num %= 10000000;
  const lakh  = Math.floor(num / 100000);     num %= 100000;
  const thousand = Math.floor(num / 1000);    num %= 1000;
  if (crore)    out += inWords(crore) + ' Crore ';
  if (lakh)     out += inWords(lakh)  + ' Lakh ';
  if (thousand) out += inWords(thousand) + ' Thousand ';
  if (num)      out += inWords(num);
  return out.trim();
}

const fmtINR = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

// ─────────────────────────────────────────────
// Allocate the next invoice number (atomic via DB sequence)
// ─────────────────────────────────────────────
async function nextInvoiceNumber() {
  const r = await db.query(`SELECT nextval('shop_invoice_seq') AS n`);
  const n = parseInt(r.rows[0].n, 10);
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
  return `KN/INV/${fy}/${String(n).padStart(5, '0')}`;
}

// ─────────────────────────────────────────────
// Generate a GST invoice PDF for a given order
// Returns: { invoice_number, invoice_path, invoice_url }
// ─────────────────────────────────────────────
async function generateInvoiceForOrder(orderId) {
  const oR = await db.query(`SELECT * FROM shop_orders WHERE id = $1`, [orderId]);
  if (!oR.rows.length) throw new Error('Order not found');
  const order = oR.rows[0];

  const iR = await db.query(`SELECT * FROM shop_order_items WHERE order_id = $1 ORDER BY id`, [orderId]);
  const items = iR.rows;

  // Reuse existing invoice number if previously generated
  const invoice_number = order.invoice_number || await nextInvoiceNumber();

  const buyerState = order.shipping_address?.state || '';
  const isInterstate = buyerState && buyerState !== SELLER.state;
  const buyerStateCode = STATE_CODES[buyerState] || '--';

  const file_name = invoice_number.replace(/[^A-Z0-9-]/gi, '_') + '.pdf';
  const file_path = path.join(INVOICE_DIR, file_name);
  const public_url = `https://knite.in/uploads/invoices/${file_name}`;

  // ── Build PDF ──
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
      Title: `Tax Invoice ${invoice_number}`, Author: SELLER.name, Subject: 'GST Tax Invoice',
    }});
    const stream = fs.createWriteStream(file_path);
    doc.pipe(stream);
    stream.on('finish', resolve);
    stream.on('error', reject);

    const NAVY = '#0a1628', CYAN = '#00b4d8', GREY = '#64748b', LIGHT = '#f1f5f9', BORDER = '#cbd5e1';
    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const X = doc.page.margins.left;
    let y = doc.page.margins.top;

    // ── Header band ──
    doc.rect(X, y, W, 70).fill(NAVY);
    doc.fillColor('#fff')
       .font('Helvetica-Bold').fontSize(22).text('KNITE', X + 18, y + 14);
    doc.font('Helvetica').fontSize(8).fillColor('#7dd3fc')
       .text('Pure Water · Pure Life', X + 18, y + 40, { characterSpacing: 1.5 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#fff')
       .text('TAX INVOICE', X, y + 18, { width: W - 18, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor('#7dd3fc')
       .text('Original for Recipient', X, y + 42, { width: W - 18, align: 'right', characterSpacing: 1.2 });

    y += 88;

    // ── Seller block ──
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text('FROM (SELLER)', X, y);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(SELLER.name, X, y + 12);
    doc.fillColor('#222').font('Helvetica').fontSize(9)
       .text(SELLER.address1, X, y + 28)
       .text(SELLER.address2, X, y + 41)
       .text(`State: ${SELLER.state} (Code: ${SELLER.stateCode})`, X, y + 54)
       .text(`GSTIN: ${SELLER.gstin}`, X, y + 67)
       .text(`LLPIN: ${SELLER.llpin}`, X, y + 80)
       .text(`Email: ${SELLER.email}  ·  Phone: ${SELLER.phone}`, X, y + 93);

    // ── Invoice meta box ──
    const metaX = X + W/2 + 10;
    const metaW = W/2 - 10;
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text('INVOICE DETAILS', metaX, y);
    const metaRows = [
      ['Invoice No', invoice_number],
      ['Invoice Date', fmtDate(new Date())],
      ['Order No', order.order_number],
      ['Order Date', fmtDate(order.created_at)],
      ['Payment', `${(order.payment_method||'').toUpperCase()} · ${(order.payment_status||'').toUpperCase()}`],
      ['Place of Supply', `${buyerState || '--'} (${buyerStateCode})`],
    ];
    let metaY = y + 12;
    metaRows.forEach(([k, v]) => {
      doc.fillColor(GREY).font('Helvetica').fontSize(8.5).text(k + ':', metaX, metaY);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(v, metaX + 80, metaY, { width: metaW - 80 });
      metaY += 13;
    });

    y += 120;

    // ── Buyer block ──
    const addr = order.shipping_address || {};
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text('BILL TO / SHIP TO', X, y);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(addr.full_name || order.customer_name, X, y + 12);
    doc.fillColor('#222').font('Helvetica').fontSize(9);
    const addrLines = [
      addr.line1, addr.line2,
      `${addr.city || ''}, ${buyerState} ${addr.pincode || ''}`,
      `State Code: ${buyerStateCode}`,
      `Phone: +91 ${order.customer_phone}  ·  Email: ${order.customer_email}`,
    ].filter(Boolean);
    let by = y + 28;
    addrLines.forEach(line => { doc.text(line, X, by); by += 13; });

    y = by + 16;

    // ── Items table ──
    const cols = isInterstate
      ? [
          { label:'#',       w: 22, align:'left'  },
          { label:'Description', w: 175, align:'left' },
          { label:'HSN',     w: 50, align:'center' },
          { label:'Qty',     w: 30, align:'right' },
          { label:'Rate',    w: 60, align:'right' },
          { label:'Taxable', w: 65, align:'right' },
          { label:'IGST 18%',w: 65, align:'right' },
          { label:'Total',   w: 60, align:'right' },
        ]
      : [
          { label:'#',       w: 22, align:'left'  },
          { label:'Description', w: 165, align:'left' },
          { label:'HSN',     w: 48, align:'center' },
          { label:'Qty',     w: 28, align:'right' },
          { label:'Rate',    w: 55, align:'right' },
          { label:'Taxable', w: 60, align:'right' },
          { label:'CGST 9%', w: 50, align:'right' },
          { label:'SGST 9%', w: 50, align:'right' },
          { label:'Total',   w: 49, align:'right' },
        ];

    // Header row
    doc.rect(X, y, W, 22).fill(NAVY);
    let cx = X + 6;
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
    cols.forEach(c => {
      doc.text(c.label, cx, y + 7, { width: c.w - 4, align: c.align });
      cx += c.w;
    });

    y += 22;

    // Item rows
    doc.font('Helvetica').fontSize(9).fillColor('#222');
    let subtotalBase = 0, totalTax = 0, totalGross = 0;

    items.forEach((item, idx) => {
      const qty = item.quantity;
      const lineTotal = +item.line_total;
      const lineTax = +item.line_tax;
      const lineBase = +item.line_subtotal;
      subtotalBase += lineBase;
      totalTax += lineTax;
      totalGross += lineTotal;

      // Alternate row shading
      if (idx % 2 === 0) {
        doc.rect(X, y, W, 22).fillColor(LIGHT).fill();
      }
      doc.fillColor('#222').font('Helvetica').fontSize(9);
      cx = X + 6;
      const values = isInterstate
        ? [ idx+1, item.product_name, item.hsn_code || '8421', qty, fmtINR(item.unit_price),
            fmtINR(lineBase), fmtINR(lineTax), fmtINR(lineTotal) ]
        : [ idx+1, item.product_name, item.hsn_code || '8421', qty, fmtINR(item.unit_price),
            fmtINR(lineBase), fmtINR(lineTax/2), fmtINR(lineTax/2), fmtINR(lineTotal) ];
      cols.forEach((c, i) => {
        doc.text(String(values[i]), cx, y + 7, { width: c.w - 4, align: c.align, ellipsis: true });
        cx += c.w;
      });
      y += 22;
    });

    // Border for items
    doc.lineWidth(0.6).strokeColor(BORDER);
    doc.rect(X, y - items.length * 22 - 22, W, items.length * 22 + 22).stroke();

    y += 10;

    // ── Totals box ──
    const totW = 220, totX = X + W - totW;
    const cgst = totalTax / 2;
    const sgst = totalTax / 2;
    const totalsRows = [
      ['Subtotal (Taxable Value)',  fmtINR(subtotalBase)],
      isInterstate ? ['IGST @ 18%', fmtINR(totalTax)] : null,
      !isInterstate ? ['CGST @ 9%', fmtINR(cgst)] : null,
      !isInterstate ? ['SGST @ 9%', fmtINR(sgst)] : null,
      ['Shipping',                  fmtINR(+(order.shipping_amount || 0))],
      ['Discount',                  '- ' + fmtINR(+(order.discount_amount || 0))],
      ['Round Off',                 '0.00'],
    ].filter(Boolean);

    doc.fontSize(9).font('Helvetica').fillColor('#222');
    totalsRows.forEach(([k, v]) => {
      doc.text(k, totX, y, { width: totW - 80 });
      doc.text(v, totX + totW - 80, y, { width: 80, align: 'right' });
      y += 14;
    });

    // Grand total bar
    doc.rect(totX, y, totW, 26).fill(NAVY);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10)
       .text('GRAND TOTAL (INR)', totX + 10, y + 8);
    doc.fontSize(13).text('₹ ' + fmtINR(+order.total_amount),
       totX + 10, y + 7, { width: totW - 20, align: 'right' });
    y += 36;

    // Total in words
    doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(9)
       .text('Amount in words: ' + numberToWords(+order.total_amount) + ' Rupees Only',
              X, y, { width: W });
    y += 26;

    // ── Terms + signature ──
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text('TERMS & CONDITIONS', X, y);
    doc.fillColor('#222').font('Helvetica').fontSize(8.5);
    const terms = [
      '1. This is a digitally generated invoice and does not require a physical signature.',
      '2. Goods once sold will only be replaced as per our 7-day return policy on knite.in.',
      '3. Warranty: 1 year comprehensive from invoice date.',
      '4. All disputes are subject to Delhi jurisdiction only.',
      '5. GSTIN provided is the registered identifier of Axios Enterprise LLP under the GST Act, 2017.',
    ];
    let ty = y + 12;
    terms.forEach(t => { doc.text(t, X, ty, { width: W/2 - 10 }); ty += 12; });

    // Signature box (right)
    const sigX = X + W/2 + 10;
    doc.fillColor(GREY).font('Helvetica').fontSize(8).text('FOR ' + SELLER.name.toUpperCase(), sigX, y);
    doc.rect(sigX, y + 18, W/2 - 10, 48).strokeColor(BORDER).stroke();
    doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(8)
       .text('Authorised Signatory', sigX + 4, y + 70);

    // ── Footer band ──
    const footerY = doc.page.height - doc.page.margins.bottom - 26;
    doc.rect(X, footerY, W, 26).fill(NAVY);
    doc.fillColor('#7dd3fc').font('Helvetica').fontSize(8)
       .text(SELLER.website + '  ·  ' + SELLER.email + '  ·  ' + SELLER.phone,
              X, footerY + 9, { width: W, align: 'center' });

    doc.end();
  });

  // Persist invoice info on the order
  await db.query(
    `UPDATE shop_orders
        SET invoice_number = $1,
            invoice_url    = $2,
            invoice_generated_at = COALESCE(invoice_generated_at, NOW())
      WHERE id = $3`,
    [invoice_number, public_url, orderId]
  );

  console.log(`[INVOICE] generated ${invoice_number} for order ${order.order_number} → ${public_url}`);
  return { invoice_number, file_path, invoice_url: public_url };
}

module.exports = { generateInvoiceForOrder };
