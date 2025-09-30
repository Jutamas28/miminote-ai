// mimi-bridge.js — hook element เดิม โดยไม่เปลี่ยนหน้าตา
(function () {
  // หา input[type=file] ตัวแรกในหน้า
  const fileInput =
    document.querySelector('input[type="file"]') ||
    document.getElementById('file') ||
    document.querySelector('[data-file]');

  // ปุ่มกดเดิม: ลองหา id=run หรือปุ่มที่มีคำว่า "แปลง" / "อัปโหลด"
  const runBtn =
    document.getElementById('run') ||
    Array.from(document.querySelectorAll('button,input[type="submit"]')).find(b =>
      /แปลง|อัปโหลด|upload|transcribe|process/i.test(b.textContent || b.value || '')
    );

  // ช่องภาษา (ถ้ามี)
  const langEl =
    document.getElementById('lang') ||
    document.querySelector('select[name="language"]') ||
    document.querySelector('[data-language]');

  // จุดแสดงผล (ถ้ามี)
  const statusEl = document.getElementById('status') || document.querySelector('[data-status]');
  const transcriptEl = document.getElementById('transcript') || document.querySelector('[data-transcript]');
  const summaryEl = document.getElementById('summary') || document.querySelector('[data-summary]');

  // ถ้าไม่มีช่องไฟล์หรือปุ่ม ให้หยุด (ไม่แตะ UI ใดๆ)
  if (!fileInput || !runBtn) {
    console.warn('[mimi-bridge] not bound: missing file input or run button');
    return;
  }

  // ถ้าปุ่มอยู่ใน <form> ป้องกันการ submit ออกจากหน้า
  runBtn.addEventListener('click', function (ev) {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      alert('กรุณาเลือกไฟล์เสียง/วิดีโอก่อน');
      return;
    }

    // อัปเดตสถานะ (ถ้ามี element ให้แสดง)
    if (statusEl) statusEl.textContent = 'กำลังอัปโหลด...';

    // สร้างฟอร์มตามชื่อฟิลด์ที่ backend รองรับ (audio)
    const form = new FormData();
    form.append('audio', file);
    if (langEl && langEl.value) form.append('language', langEl.value);

    // ยิงไปปลายทางรวมงาน: /api/process ที่พอร์ตเดียวกับหน้า (5051)
    fetch('/api/process', { method: 'POST', body: form })
      .then(async (r) => {
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { throw new Error(text); }
        if (!r.ok) throw new Error(JSON.stringify(data));

        // เติมผลลัพธ์เฉพาะเมื่อหน้ามีที่วางอยู่แล้ว (ไม่สร้าง UI ใหม่)
        if (transcriptEl) transcriptEl.textContent = data.transcription || data.text || '';
        if (summaryEl) summaryEl.textContent = data.summary || '';
        if (statusEl) statusEl.textContent = 'เสร็จแล้ว ✅';

        console.log('[mimi-bridge] done', data);
      })
      .catch((err) => {
        console.error('[mimi-bridge] error', err);
        if (statusEl) statusEl.textContent = 'เกิดข้อผิดพลาด ❌';
        // ไม่เปลี่ยน UI — แค่รายงานใน console
      });
  });
})();
