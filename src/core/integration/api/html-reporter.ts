/**
 * Universal Interactive HTML Reporter for API Contract Testing
 *
 * Sinh file HTML độc lập (standalone, zero-dependency, works offline)
 * chứa giao diện Dashboard tương tác hiện đại để xem chi tiết kết quả test API.
 */

import fs from 'fs';
import path from 'path';
import type { ApiTestRunResult, ApiTestResult } from './schema.js';

import type { AnomalyReport } from './anomaly-detector.js';

export function renderApiHtmlReport(result: ApiTestRunResult, anomaly?: AnomalyReport): string {
  const passRate = result.totalTests > 0
    ? Math.round((result.passedTests / result.totalTests) * 100)
    : 0;

  const skippedCount = result.tests.filter(t => t.name.includes('(SKIPPED)') || t.response?.statusText === 'SKIPPED').length;
  const actualFailed = result.failedTests;
  const actualPassed = result.passedTests - skippedCount;

  const serializedData = JSON.stringify(result)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  const serializedAnomaly = JSON.stringify(anomaly || {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Integration Test Report — ${escapeHtml(result.baseUrl)}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --pass: #10b981;
      --fail: #ef4444;
      --skip: #64748b;
      --primary: #3b82f6;
      --method-get: #0284c7;
      --method-post: #16a34a;
      --method-put: #d97706;
      --method-patch: #0d9488;
      --method-delete: #dc2626;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1300px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .title-group h1 { font-size: 24px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .title-group p { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-pass { background: rgba(16, 185, 129, 0.15); color: var(--pass); border: 1px solid var(--pass); }
    .badge-fail { background: rgba(239, 68, 68, 0.15); color: var(--fail); border: 1px solid var(--fail); }
    .badge-skip { background: rgba(100, 116, 139, 0.2); color: var(--skip); border: 1px solid var(--skip); }

    /* Summary Cards */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
    }
    .card-label { font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 28px; font-weight: 700; margin-top: 6px; }

    /* Controls Bar */
    .controls {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }
    .search-input {
      flex: 1;
      min-width: 250px;
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .search-input:focus { border-color: var(--primary); }
    .filter-btn-group { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .btn:hover, .btn.active {
      color: var(--text);
      border-color: var(--primary);
      background: rgba(59, 130, 246, 0.1);
    }
    .btn.active-all { border-color: var(--primary); color: #fff; background: var(--primary); }
    .btn.active-pass { border-color: var(--pass); color: #fff; background: var(--pass); }
    .btn.active-fail { border-color: var(--fail); color: #fff; background: var(--fail); }
    .btn.active-skip { border-color: var(--skip); color: #fff; background: var(--skip); }

    /* Test List */
    .test-list { display: flex; flex-direction: column; gap: 8px; }
    .test-item {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      transition: border-color 0.15s ease;
    }
    .test-item:hover { border-color: #475569; }
    .test-header {
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      gap: 12px;
      user-select: none;
    }
    .test-meta { display: flex; align-items: center; gap: 12px; flex: 1; overflow: hidden; }
    .method-tag {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      color: #fff;
      min-width: 54px;
      text-align: center;
    }
    .method-get { background: var(--method-get); }
    .method-post { background: var(--method-post); }
    .method-put { background: var(--method-put); }
    .method-patch { background: var(--method-patch); }
    .method-delete { background: var(--method-delete); }
    .test-path { font-family: monospace; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .test-right { display: flex; align-items: center; gap: 12px; }
    .duration-tag { color: var(--text-muted); font-size: 12px; }
    .status-pill {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .status-2xx { background: rgba(16, 185, 129, 0.2); color: var(--pass); }
    .status-4xx { background: rgba(239, 68, 68, 0.2); color: var(--fail); }
    .status-5xx { background: rgba(239, 68, 68, 0.3); color: var(--fail); font-weight: 700; }

    /* Test Detail Body */
    .test-body {
      display: none;
      padding: 16px;
      border-top: 1px solid var(--border);
      background: #131d31;
    }
    .test-body.expanded { display: block; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } }
    .detail-box {
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
    }
    .detail-box h4 { font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
    pre {
      background: #090d16;
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      font-family: monospace;
      font-size: 12px;
      color: #cbd5e1;
      max-height: 250px;
    }
    .assertion-list { margin-top: 12px; }
    .assertion-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      padding: 6px 10px;
      background: #0f172a;
      border-radius: 4px;
      margin-bottom: 4px;
    }
    .copy-btn {
      background: #1e293b;
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
    }
    .copy-btn:hover { color: #fff; background: var(--primary); }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--pass);
      color: #fff;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5);
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="title-group">
        <h1>🧪 API Integration Test Report</h1>
        <p>Base URL: <strong>${escapeHtml(result.baseUrl)}</strong> • Bắt đầu lúc: ${new Date(result.startedAt).toLocaleString('vi-VN')} • Tổng thời gian: ${(result.durationMs / 1000).toFixed(2)}s</p>
      </div>
      <div>
        <span class="badge ${result.ok ? 'badge-pass' : 'badge-fail'}">
          ${result.ok ? '🟢 TẤT CẢ TEST ĐÃ PASS' : '❌ CÓ TEST THẤT BẠI'}
        </span>
      </div>
    </header>

    <!-- Summary Metrics -->
    <div class="summary-grid">
      <div class="card">
        <div class="card-label">Tổng số Tests</div>
        <div class="card-value">${result.totalTests}</div>
      </div>
      <div class="card">
        <div class="card-label">Tỉ lệ Pass</div>
        <div class="card-value" style="color: ${passRate >= 80 ? 'var(--pass)' : 'var(--fail)'};">${passRate}%</div>
      </div>
      <div class="card">
        <div class="card-label">Đã Pass (Thực tế)</div>
        <div class="card-value" style="color: var(--pass);">${actualPassed}</div>
      </div>
      <div class="card">
        <div class="card-label">Thất bại (Failed)</div>
        <div class="card-value" style="color: var(--fail);">${actualFailed}</div>
      </div>
      <div class="card">
        <div class="card-label">Bỏ qua (Skipped Safe Mode)</div>
        <div class="card-value" style="color: var(--skip);">${skippedCount}</div>
      </div>
    </div>

    <!-- Filter & Search Controls -->
    <div class="controls">
      <input type="text" id="searchBox" class="search-input" placeholder="🔍 Tìm kiếm theo URL, Method, Tên test...">
      <div class="filter-btn-group">
        <button class="btn active active-all" data-status="ALL">Tất cả (${result.totalTests})</button>
        <button class="btn" data-status="PASS">✅ Pass (${result.passedTests})</button>
        <button class="btn" data-status="FAIL">❌ Fail (${result.failedTests})</button>
        <button class="btn" data-status="SKIP">⏭️ Skipped (${skippedCount})</button>
      </div>
      <div class="filter-btn-group">
        <button class="btn active" data-method="ALL">Mọi Method</button>
        <button class="btn" data-method="GET">GET</button>
        <button class="btn" data-method="POST">POST</button>
        <button class="btn" data-method="PUT">PUT</button>
        <button class="btn" data-method="PATCH">PATCH</button>
        <button class="btn" data-method="DELETE">DELETE</button>
      </div>
    </div>

    <!-- Test List -->
    <div class="test-list" id="testList"></div>
  </div>

  <div class="toast" id="toast">Đã copy cURL vào clipboard!</div>

  <script>
    const reportData = ${serializedData};
    let currentStatusFilter = 'ALL';
    let currentMethodFilter = 'ALL';
    let searchQuery = '';

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function renderTests() {
      const listEl = document.getElementById('testList');
      listEl.innerHTML = '';

      const filtered = reportData.tests.filter(t => {
        const isSkip = t.name.includes('(SKIPPED)') || t.response?.statusText === 'SKIPPED';
        
        // Status filter
        if (currentStatusFilter === 'PASS' && (!t.ok || isSkip)) return false;
        if (currentStatusFilter === 'FAIL' && t.ok) return false;
        if (currentStatusFilter === 'SKIP' && !isSkip) return false;

        // Method filter
        if (currentMethodFilter !== 'ALL' && t.request.method !== currentMethodFilter) return false;

        // Search query
        if (searchQuery) {
          const matchQuery = (t.request.url || '').toLowerCase().includes(searchQuery) ||
                             (t.name || '').toLowerCase().includes(searchQuery) ||
                             (t.id || '').toLowerCase().includes(searchQuery) ||
                             (t.error || '').toLowerCase().includes(searchQuery);
          if (!matchQuery) return false;
        }

        return true;
      });

      if (filtered.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">Không tìm thấy test case phù hợp với bộ lọc.</div>';
        return;
      }

      filtered.forEach((t, idx) => {
        const isSkip = t.name.includes('(SKIPPED)') || t.response?.statusText === 'SKIPPED';
        const method = (t.request.method || 'GET').toUpperCase();
        const status = t.response?.status || (t.ok ? 200 : 500);
        const statusClass = status >= 500 ? 'status-5xx' : (status >= 400 ? 'status-4xx' : 'status-2xx');

        const item = document.createElement('div');
        item.className = 'test-item';
        item.innerHTML = \`
          <div class="test-header" onclick="toggleDetail('\${t.id}')">
            <div class="test-meta">
              <span class="method-tag method-\${method.toLowerCase()}">\${method}</span>
              <span class="test-path">\${escapeHtml(t.request.url || t.name)}</span>
            </div>
            <div class="test-right">
              <span class="duration-tag">\${t.durationMs}ms</span>
              <span class="status-pill \${statusClass}">HTTP \${status}</span>
              <span>\${isSkip ? '⏭️' : (t.ok ? '✅' : '❌')}</span>
            </div>
          </div>
          <div class="test-body" id="body-\${t.id}">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <div><strong>ID:</strong> \${escapeHtml(t.id)} • <strong>Oracle:</strong> \${t.oracle?.intentType || 'SPECIFICATION'}</div>
              <button class="copy-btn" onclick="copyCurl('\${t.id}')">📋 Copy cURL</button>
            </div>
            <div class="detail-grid">
              <div class="detail-box">
                <h4>Request Details</h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">URL: \${escapeHtml(t.request.url)}</p>
                <pre>\${escapeHtml(JSON.stringify(t.response?.body ? t.request : { method: t.request.method, url: t.request.url }, null, 2))}</pre>
              </div>
              <div class="detail-box">
                <h4>Response Details (Status \${status})</h4>
                <pre>\${escapeHtml(t.response?.rawBody || JSON.stringify(t.response?.body || t.error || {}, null, 2))}</pre>
              </div>
            </div>
            <div class="assertion-list">
              <h4 style="font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Assertions (\${t.assertions.length})</h4>
              \${t.assertions.map(a => \`
                <div class="assertion-item">
                  <span>\${a.ok ? '✅' : '❌'}</span>
                  <span>\${escapeHtml(a.message)}</span>
                </div>
              \`).join('')}
              \${t.error ? \`<div class="assertion-item" style="color: var(--fail);"><span>❌</span><span>\${escapeHtml(t.error)}</span></div>\` : ''}
            </div>
          </div>
        \`;
        listEl.appendChild(item);
      });
    }

    function toggleDetail(id) {
      const el = document.getElementById('body-' + id);
      if (el) el.classList.toggle('expanded');
    }

    function copyCurl(id) {
      const t = reportData.tests.find(item => item.id === id);
      if (!t) return;
      const curl = \`curl -X \${t.request.method} "\${t.request.url}" -H "Accept: application/json"\`;
      navigator.clipboard.writeText(curl).then(() => {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
      });
    }

    // Filter Listeners
    document.querySelectorAll('[data-status]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-status]').forEach(b => {
          b.className = 'btn';
        });
        e.target.className = 'btn active active-' + e.target.getAttribute('data-status').toLowerCase();
        currentStatusFilter = e.target.getAttribute('data-status');
        renderTests();
      });
    });

    document.querySelectorAll('[data-method]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('[data-method]').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentMethodFilter = e.target.getAttribute('data-method');
        renderTests();
      });
    });

    document.getElementById('searchBox').addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      renderTests();
    });

    renderTests();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function writeApiHtmlReport(
  result: ApiTestRunResult,
  outputPath = 'artifacts/api-test-report.html',
  anomaly?: AnomalyReport,
): string {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const html = renderApiHtmlReport(result, anomaly);
  fs.writeFileSync(outputPath, html, 'utf-8');
  return outputPath;
}
