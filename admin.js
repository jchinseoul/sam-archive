// ============================================================
// SAM ARCHIVE 게시물 올리기 — GitHub 저장소에 직접 커밋하는 관리자 도구.
// archive.md는 호수→유형처럼 고정된 형식이 아니라 자유로운 중첩 불릿이므로,
// 이 도구도 "1단계/2단계 항목"을 실제 archive.md에서 읽어와 동적으로 보여준다.
// ============================================================

const OWNER = 'jchinseoul';
const REPO = 'sam-archive';
const BRANCH = 'main';
const TOKEN_STORAGE_KEY = 'sam_archive_admin_token';
const NEW_OPTION = '__new__';
const NONE_OPTION = '__none__';

const els = {
  token: document.getElementById('token'),
  rememberToken: document.getElementById('rememberToken'),
  level1Select: document.getElementById('level1Select'),
  level1NewWrap: document.getElementById('level1NewWrap'),
  level1New: document.getElementById('level1New'),
  level2Select: document.getElementById('level2Select'),
  level2NewWrap: document.getElementById('level2NewWrap'),
  level2New: document.getElementById('level2New'),
  level3Select: document.getElementById('level3Select'),
  level3NewWrap: document.getElementById('level3NewWrap'),
  level3New: document.getElementById('level3New'),
  title: document.getElementById('title'),
  imageFile: document.getElementById('imageFile'),
  docFile: document.getElementById('docFile'),
  videoFile: document.getElementById('videoFile'),
  videoUrl: document.getElementById('videoUrl'),
  sizeWarning: document.getElementById('sizeWarning'),
  bodyText: document.getElementById('bodyText'),
  form: document.getElementById('postForm'),
  submitBtn: document.getElementById('submitBtn'),
  status: document.getElementById('status'),
  refreshLevelsBtn: document.getElementById('refreshLevelsBtn'),
  levelLoadStatus: document.getElementById('levelLoadStatus'),
  manageLevel1Select: document.getElementById('manageLevel1Select'),
  manageLevel2Select: document.getElementById('manageLevel2Select'),
  manageStatus: document.getElementById('manageStatus'),
  manageList: document.getElementById('manageList'),
  editPanel: document.getElementById('editPanel'),
  editTitle: document.getElementById('editTitle'),
  editCurrentHint: document.getElementById('editCurrentHint'),
  editCurrentPreview: document.getElementById('editCurrentPreview'),
  editImageFile: document.getElementById('editImageFile'),
  editDocFile: document.getElementById('editDocFile'),
  editVideoFile: document.getElementById('editVideoFile'),
  editVideoUrl: document.getElementById('editVideoUrl'),
  editBodyText: document.getElementById('editBodyText'),
  editSaveBtn: document.getElementById('editSaveBtn'),
  editCancelBtn: document.getElementById('editCancelBtn'),
  editStatus: document.getElementById('editStatus'),
};

// GitHub Contents API는 파일 하나당 사실상 100MB가 한계이고, 그보다 훨씬 작아도
// 저장소가 무거워지므로 이 이상이면 경고만 보여준다(업로드 자체는 막지 않음).
const VIDEO_WARN_BYTES = 15 * 1024 * 1024; // 15MB

els.videoFile.addEventListener('change', () => {
  const file = els.videoFile.files[0];
  if (!file) { els.sizeWarning.style.display = 'none'; return; }
  if (file.size > VIDEO_WARN_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    els.sizeWarning.textContent = `⚠️ 이 영상은 ${mb}MB입니다. GitHub 저장소에 큰 파일을 계속 올리면 저장소가 무거워질 수 있어요. 그래도 업로드는 진행됩니다.`;
    els.sizeWarning.style.display = 'block';
  } else {
    els.sizeWarning.style.display = 'none';
  }
});

// ---------- GitHub API 헬퍼 ----------
function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
}

async function ghGetFile(path, token) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`,
    { headers: ghHeaders(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} 실패 (${res.status})`);
  return res.json(); // { content(base64, 줄바꿈 포함), sha }
}

async function ghPutText(path, token, text, message, sha) {
  const body = { message, content: b64EncodeUtf8(text), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} 저장 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

async function ghPutBinaryBase64(path, token, base64Content, message) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, branch: BRANCH }),
  });
  if (!res.ok) throw new Error(`${path} 업로드 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- 최근 업데이트 기록 (마인드맵에 빨간 점으로 표시됨) ----------
const UPDATES_FILE = 'updates.json';
const UPDATES_KEEP_DAYS = 30; // 이보다 오래된 기록은 파일이 계속 커지지 않도록 정리

// 이번에 글을 추가한 카테고리(1단계·2단계 이름)를 "방금 업데이트됨"으로 기록한다.
// app.js가 이 파일을 읽어서, 최근 며칠 안에 올라온 카테고리 글자에 빨간 점을 붙인다.
async function markUpdated(names, token) {
  const existing = await ghGetFile(UPDATES_FILE, token);
  let list = [];
  if (existing) {
    try { list = JSON.parse(b64DecodeUtf8(existing.content)); } catch { list = []; }
  }
  const cutoff = Date.now() - UPDATES_KEEP_DAYS * 24 * 60 * 60 * 1000;
  list = list.filter((entry) => entry && typeof entry.at === 'number' && entry.at > cutoff);

  const now = Date.now();
  names.forEach((name) => {
    if (!name) return;
    list.push({ name, at: now });
  });

  await ghPutText(
    UPDATES_FILE,
    token,
    JSON.stringify(list),
    `Mark updated: ${names.filter(Boolean).join(', ')}`,
    existing ? existing.sha : undefined,
  );
}

// ---------- archive.md 파싱 (호수/유형 같은 고정 이름 없이, 들여쓰기만으로 계층 판단) ----------
function stripDecoration(s) {
  return s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu, '').trim();
}

function indentOf(line) {
  const m = line.match(/^(\s*)-/);
  return m ? m[1].length : null;
}

// level1 -> level2 -> Set(level3) 형태로, 실제 archive.md에 있는 1/2/3단계 항목만 뽑는다.
function parseLevels(mdText) {
  const lines = mdText.split('\n');
  const map = new Map(); // level1 -> Map(level2 -> Set(level3))
  let currentLevel1 = null;
  let currentLevel2 = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const ind = indentOf(line);
    if (ind === null) continue;
    const m = line.match(/^\s*-\s+(.*)$/);
    if (!m) continue;
    const text = m[1].trim();

    if (ind === 0) {
      currentLevel1 = text;
      currentLevel2 = null;
      if (!map.has(currentLevel1)) map.set(currentLevel1, new Map());
    } else if (ind === 2 && currentLevel1) {
      currentLevel2 = text;
      if (!map.get(currentLevel1).has(currentLevel2)) map.get(currentLevel1).set(currentLevel2, new Set());
    } else if (ind === 4 && currentLevel1 && currentLevel2) {
      map.get(currentLevel1).get(currentLevel2).add(text);
    }
  }
  return map;
}

function findBlockEnd(lines, startIdx, indent) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const ind = indentOf(lines[i]);
    if (ind !== null && ind <= indent) return i;
  }
  return lines.length;
}

// parentIdx===-1 이면 문서 최상위(1단계)에서 찾는다. 없으면 null.
function findChild(lines, parentIdx, parentIndent, name) {
  const indent = parentIdx === -1 ? 0 : parentIndent + 2;
  const searchStart = parentIdx === -1 ? 0 : parentIdx + 1;
  const searchEnd = parentIdx === -1 ? lines.length : findBlockEnd(lines, parentIdx, parentIndent);

  for (let i = searchStart; i < searchEnd; i++) {
    if (!lines[i].trim()) continue;
    if (indentOf(lines[i]) === indent) {
      const m = lines[i].match(/^\s*-\s+(.*)$/);
      if (m && stripDecoration(m[1]) === stripDecoration(name)) {
        return { idx: i, indent };
      }
    }
  }
  return null;
}

// findChild와 같지만 없으면 부모 블록 끝에 새로 만든다.
function ensureChild(lines, parentIdx, parentIndent, name) {
  const found = findChild(lines, parentIdx, parentIndent, name);
  if (found) return found;

  const indent = parentIdx === -1 ? 0 : parentIndent + 2;
  const searchEnd = parentIdx === -1 ? lines.length : findBlockEnd(lines, parentIdx, parentIndent);
  const prefix = ' '.repeat(indent);
  if (parentIdx === -1) {
    if (lines[lines.length - 1] !== undefined && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`${prefix}- ${name}`);
    return { idx: lines.length - 1, indent };
  }
  lines.splice(searchEnd, 0, `${prefix}- ${name}`);
  return { idx: searchEnd, indent };
}

// 특정 줄(idx, indent)이 리프인지(자식이 없는지) 판단한다.
function isLeafLine(lines, idx, indent) {
  for (let i = idx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const ind = indentOf(lines[i]);
    return ind === null || ind <= indent;
  }
  return true;
}

// 주어진 부모(level2 또는 level3) 블록 아래의 모든 리프(게시물)를 재귀적으로 모은다.
// 중간에 더 깊은 하위 카테고리가 있으면 그 이름을 path에 쌓아가며 계속 내려간다.
function collectLeaves(lines, parentIdx, parentIndent, pathPrefix) {
  const indent = parentIndent + 2;
  const end = findBlockEnd(lines, parentIdx, parentIndent);
  const results = [];

  for (let i = parentIdx + 1; i < end; i++) {
    if (!lines[i].trim()) continue;
    if (indentOf(lines[i]) !== indent) continue;
    const m = lines[i].match(/^\s*-\s+(.*)$/);
    if (!m) continue;
    const content = m[1].trim();
    const linkMatch = content.match(/^\[(.+)\]\((.+)\)$/);
    const name = linkMatch ? linkMatch[1] : content;

    if (isLeafLine(lines, i, indent)) {
      results.push({
        lineIndex: i,
        lineText: lines[i],
        indent,
        path: pathPrefix,
        title: name,
        target: linkMatch ? linkMatch[2] : null,
      });
    } else {
      results.push(...collectLeaves(lines, i, indent, [...pathPrefix, name]));
    }
  }
  return results;
}

// 게시물의 첨부(target)가 가리키는 assets/ 파일 경로 목록을 뽑아낸다.
// 외부 링크(영상 URL 등)나 첨부 없음이면 빈 배열.
function extractAssetPaths(target) {
  if (!target) return [];
  if (/^https?:\/\//.test(target)) return [];
  if (target.startsWith('gallery.html?')) {
    const qs = target.split('?')[1] || '';
    const sp = new URLSearchParams(qs);
    const imgs = (sp.get('imgs') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const textPath = sp.get('text');
    return textPath ? [...imgs, textPath] : imgs;
  }
  if (target.startsWith('assets/')) return [target];
  return [];
}

async function deleteAsset(path, token) {
  const file = await ghGetFile(path, token);
  if (!file) return; // 이미 없으면 조용히 넘어간다
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Delete asset ${path}`, sha: file.sha, branch: BRANCH }),
  });
  if (!res.ok) throw new Error(`${path} 삭제 실패 (${res.status})`);
}

function insertPost(mdText, { level1, level2, level3, leafLine }) {
  const lines = mdText.split('\n');
  // 파일 끝의 빈 줄들을 미리 정리해둔다. 그대로 두면 문서의 맨 마지막 블록에
  // 이어붙일 때(findBlockEnd가 lines.length를 반환하는 경우) 그 빈 줄 뒤에
  // 삽입되면서 불필요한 빈 줄이 하나 남는다.
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  const l1 = ensureChild(lines, -1, 0, level1);
  const l2 = ensureChild(lines, l1.idx, l1.indent, level2);
  const parent = level3 ? ensureChild(lines, l2.idx, l2.indent, level3) : l2;

  const leafIndent = parent.indent + 2;
  const leafEnd = findBlockEnd(lines, parent.idx, parent.indent);
  lines.splice(leafEnd, 0, `${' '.repeat(leafIndent)}${leafLine}`);
  return lines.join('\n');
}

// ---------- 파일명 생성 ----------
function timestampSlug() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- 상태 표시 ----------
function setStatus(msg, kind) {
  els.status.textContent = msg;
  els.status.className = kind || '';
}

// ---------- 드롭다운 채우기 ----------
let levelMap = new Map();

function fillSelectWithNewOption(select, names, keepValue) {
  select.innerHTML = '';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = NEW_OPTION;
  newOpt.textContent = '+ 새로 추가';
  select.append(newOpt);
  if (keepValue && names.includes(keepValue)) select.value = keepValue;
  else select.value = names.length ? names[0] : NEW_OPTION;
}

function updateLevel1NewVisibility() {
  els.level1NewWrap.hidden = els.level1Select.value !== NEW_OPTION;
}

function updateLevel2Options() {
  const level1 = els.level1Select.value;
  const level2Names = level1 !== NEW_OPTION && levelMap.has(level1) ? [...levelMap.get(level1).keys()] : [];
  fillSelectWithNewOption(els.level2Select, level2Names);
  els.level2NewWrap.hidden = els.level2Select.value !== NEW_OPTION;
  updateLevel3Options();
}

// 3단계는 선택 사항이라, 실제 항목 이름들 앞에 "사용 안 함"을 기본값으로 넣어둔다.
function fillLevel3Select(names) {
  const select = els.level3Select;
  select.innerHTML = '';
  const noneOpt = document.createElement('option');
  noneOpt.value = NONE_OPTION;
  noneOpt.textContent = '사용 안 함 (2단계 아래 바로 추가)';
  select.append(noneOpt);
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = NEW_OPTION;
  newOpt.textContent = '+ 새로 추가';
  select.append(newOpt);
  select.value = NONE_OPTION;
}

function updateLevel3Options() {
  const level1 = els.level1Select.value;
  const level2 = els.level2Select.value;
  let level3Names = [];
  if (level1 !== NEW_OPTION && level2 !== NEW_OPTION && levelMap.has(level1)) {
    const level2Map = levelMap.get(level1);
    if (level2Map.has(level2)) level3Names = [...level2Map.get(level2)];
  }
  fillLevel3Select(level3Names);
  els.level3NewWrap.hidden = els.level3Select.value !== NEW_OPTION;
}

function setLevelLoadStatus(msg, kind) {
  els.levelLoadStatus.textContent = msg;
  els.levelLoadStatus.style.color = kind === 'error' ? '#c0392b' : kind === 'ok' ? 'var(--accent)' : '';
}

// 토큰이 있으면 GitHub API로 저장소의 "지금 실제" 내용을 바로 읽어온다 — 이 사이트가
// 서빙하는 archive.md는 GitHub Pages가 다시 빌드/배포할 때까지(수십 초~그 이상) 예전
// 내용을 보여줄 수 있어서, 방금 올리거나 고친 내용이 관리 화면에 곧바로 안 보이는
// 원인이었다. 토큰이 없을 때만(최초 방문 등) 공개 파일을 그냥 fetch한다.
async function fetchArchiveText() {
  const token = els.token.value.trim();
  if (token) {
    const file = await ghGetFile('archive.md', token);
    if (!file) throw new Error('archive.md 파일을 찾을 수 없습니다.');
    return b64DecodeUtf8(file.content);
  }
  const res = await fetch(`archive.md?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`archive.md 로드 실패 (${res.status})`);
  return res.text();
}

async function refreshLevels() {
  setLevelLoadStatus('항목 불러오는 중...');
  try {
    const text = await fetchArchiveText();
    levelMap = parseLevels(text);
    const prevLevel1 = els.level1Select.value;
    fillSelectWithNewOption(els.level1Select, [...levelMap.keys()], prevLevel1);
    updateLevel1NewVisibility();
    updateLevel2Options();
    refreshManageLevel1();
    setLevelLoadStatus(
      levelMap.size ? `1단계 항목 ${levelMap.size}개를 불러왔습니다.` : 'archive.md에 1단계 항목이 아직 없습니다 — 새로 추가로 시작하세요.',
      'ok',
    );
  } catch (e) {
    setLevelLoadStatus(`항목을 불러오지 못했습니다: ${e.message}`, 'error');
  }
}

els.level1Select.addEventListener('change', () => {
  updateLevel1NewVisibility();
  updateLevel2Options();
});
els.level2Select.addEventListener('change', () => {
  els.level2NewWrap.hidden = els.level2Select.value !== NEW_OPTION;
  updateLevel3Options();
});
els.level3Select.addEventListener('change', () => {
  els.level3NewWrap.hidden = els.level3Select.value !== NEW_OPTION;
});

els.refreshLevelsBtn.addEventListener('click', refreshLevels);

// ---------- 게시물 관리 (삭제 · 수정) ----------
function fillPlainSelect(select, names) {
  select.innerHTML = '';
  if (!names.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(항목 없음)';
    select.append(opt);
    return;
  }
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  });
}

function refreshManageLevel1() {
  const prev = els.manageLevel1Select.value;
  fillPlainSelect(els.manageLevel1Select, [...levelMap.keys()]);
  if (prev && [...levelMap.keys()].includes(prev)) els.manageLevel1Select.value = prev;
  updateManageLevel2();
}

function updateManageLevel2() {
  const level1 = els.manageLevel1Select.value;
  const names = levelMap.has(level1) ? [...levelMap.get(level1).keys()] : [];
  fillPlainSelect(els.manageLevel2Select, names);
  loadManageList();
}

function setManageStatus(msg, kind) {
  els.manageStatus.textContent = msg;
  els.manageStatus.style.color = kind === 'error' ? '#c0392b' : kind === 'ok' ? 'var(--accent)' : '';
}

let manageLeaves = [];

async function loadManageList() {
  const level1 = els.manageLevel1Select.value;
  const level2 = els.manageLevel2Select.value;
  els.editPanel.hidden = true;
  editingLeaf = null;
  if (!level1 || !level2) {
    manageLeaves = [];
    els.manageList.innerHTML = '';
    return;
  }
  setManageStatus('목록 불러오는 중...');
  try {
    const text = await fetchArchiveText();
    const lines = text.split('\n');
    const l1 = findChild(lines, -1, 0, level1);
    const l2 = l1 && findChild(lines, l1.idx, l1.indent, level2);
    manageLeaves = l2 ? collectLeaves(lines, l2.idx, l2.indent, []) : [];
    renderManageList();
    setManageStatus(manageLeaves.length ? `게시물 ${manageLeaves.length}개` : '게시물이 없습니다.', 'ok');
  } catch (e) {
    manageLeaves = [];
    els.manageList.innerHTML = '';
    setManageStatus(`목록을 불러오지 못했습니다: ${e.message}`, 'error');
  }
}

function renderManageList() {
  els.manageList.innerHTML = '';
  manageLeaves.forEach((leaf, index) => {
    const row = document.createElement('div');
    row.className = 'manage-row';

    const titleEl = document.createElement('span');
    titleEl.className = 'manage-title';
    titleEl.textContent = leaf.title;
    if (leaf.path.length) {
      const pathEl = document.createElement('span');
      pathEl.className = 'manage-path';
      pathEl.textContent = leaf.path.join(' / ');
      titleEl.prepend(pathEl);
    }
    row.append(titleEl);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '수정';
    editBtn.addEventListener('click', () => openEdit(index));
    row.append(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'danger';
    deleteBtn.textContent = '삭제';
    deleteBtn.addEventListener('click', () => handleDelete(index, deleteBtn));
    row.append(deleteBtn);

    els.manageList.append(row);
  });
}

async function handleDelete(index, btnEl) {
  const leaf = manageLeaves[index];
  if (btnEl.dataset.confirm !== '1') {
    btnEl.dataset.confirm = '1';
    btnEl.textContent = '정말 삭제?';
    clearTimeout(btnEl._resetTimer);
    btnEl._resetTimer = setTimeout(() => {
      btnEl.dataset.confirm = '0';
      btnEl.textContent = '삭제';
    }, 4000);
    return;
  }
  clearTimeout(btnEl._resetTimer);

  const token = els.token.value.trim();
  if (!token) { setManageStatus('GitHub 토큰을 입력해주세요.', 'error'); return; }

  btnEl.disabled = true;
  setManageStatus(`"${leaf.title}" 삭제 중...`);
  try {
    for (let attempt = 0; ; attempt++) {
      const current = await ghGetFile('archive.md', token);
      if (!current) throw new Error('archive.md를 찾을 수 없습니다.');
      const lines = b64DecodeUtf8(current.content).split('\n');
      if (lines[leaf.lineIndex] !== leaf.lineText) {
        throw new Error('그 사이 내용이 바뀐 것 같습니다. 목록을 새로고침한 뒤 다시 시도해주세요.');
      }
      lines.splice(leaf.lineIndex, 1);
      try {
        await ghPutText('archive.md', token, lines.join('\n'), `Delete "${leaf.title}"`, current.sha);
        break;
      } catch (e) {
        if (attempt === 0 && /\(409\)/.test(e.message)) continue;
        throw e;
      }
    }

    for (const assetPath of extractAssetPaths(leaf.target)) {
      try { await deleteAsset(assetPath, token); } catch (e) { console.warn('첨부 파일 삭제 실패:', e); }
    }

    setManageStatus(`"${leaf.title}" 삭제 완료.`, 'ok');
    await loadManageList();
  } catch (err) {
    setManageStatus(`삭제 실패: ${err.message}`, 'error');
    btnEl.disabled = false;
    btnEl.dataset.confirm = '0';
    btnEl.textContent = '삭제';
  }
}

let editingLeaf = null;

// gallery.html?imgs=...&text=... 링크에서 이미지 경로 목록과 설명글 경로를 뽑아낸다.
function parseGalleryTarget(target) {
  const sp = new URLSearchParams(target.split('?')[1] || '');
  const imgs = (sp.get('imgs') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const textPath = sp.get('text');
  return { imgs, textPath };
}

async function openEdit(index) {
  const leaf = manageLeaves[index];
  editingLeaf = leaf;
  els.editTitle.value = leaf.title;
  els.editImageFile.value = '';
  els.editDocFile.value = '';
  els.editVideoFile.value = '';
  els.editVideoUrl.value = '';
  els.editBodyText.value = '';
  els.editCurrentPreview.innerHTML = '';
  setEditStatus('');
  els.editPanel.hidden = false;
  els.editPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const target = leaf.target;
  if (!target) {
    els.editCurrentHint.textContent = '현재 첨부 없음 (글자만 있는 항목)';
    return;
  }
  if (/^https?:\/\//.test(target)) {
    els.editCurrentHint.textContent = '현재 영상 링크 (아래에 그대로 채워둠, 그대로 저장해도 됩니다):';
    els.editVideoUrl.value = target;
    return;
  }
  if (target.startsWith('gallery.html?')) {
    const { imgs, textPath } = parseGalleryTarget(target);
    els.editCurrentHint.textContent = `현재 이미지 ${imgs.length}장 — 아래 "글 내용"만 고치면 이미지는 그대로 유지됩니다.`;
    imgs.forEach((src) => {
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'max-height:110px;max-width:140px;object-fit:cover;border-radius:6px;margin:0 .4rem .4rem 0;';
      els.editCurrentPreview.append(img);
    });
    if (textPath) {
      try {
        const res = await fetch(`${textPath}?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) els.editBodyText.value = await res.text();
      } catch { /* 설명글을 못 불러와도 이미지 목록은 이미 보여줬으니 무시 */ }
    }
    return;
  }
  if (target.endsWith('.txt')) {
    els.editCurrentHint.textContent = '현재 글 내용 (아래에 그대로 채워둠):';
    try {
      const res = await fetch(`${target}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) els.editBodyText.value = await res.text();
    } catch { /* 무시 */ }
    return;
  }
  els.editCurrentHint.textContent = '현재 첨부 파일:';
  const a = document.createElement('a');
  a.href = target;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = target;
  els.editCurrentPreview.append(a);
}

function setEditStatus(msg, kind) {
  els.editStatus.textContent = msg;
  els.editStatus.style.color = kind === 'error' ? '#c0392b' : kind === 'ok' ? 'var(--accent)' : '';
}

els.editCancelBtn.addEventListener('click', () => {
  els.editPanel.hidden = true;
  editingLeaf = null;
});

els.editSaveBtn.addEventListener('click', async () => {
  if (!editingLeaf) return;
  const token = els.token.value.trim();
  if (!token) { setEditStatus('GitHub 토큰을 입력해주세요.', 'error'); return; }
  const title = els.editTitle.value.trim();
  if (!title) { setEditStatus('제목을 입력해주세요.', 'error'); return; }

  const imageFiles = [...els.editImageFile.files];
  const docFile = els.editDocFile.files[0];
  const videoFile = els.editVideoFile.files[0];
  const videoUrl = els.editVideoUrl.value.trim();
  const bodyText = els.editBodyText.value.trim();
  const isGalleryPost = Boolean(editingLeaf.target && editingLeaf.target.startsWith('gallery.html?'));
  const existingGallery = isGalleryPost ? parseGalleryTarget(editingLeaf.target) : null;

  els.editSaveBtn.disabled = true;
  setEditStatus('저장 중...');
  try {
    let newTarget = editingLeaf.target; // 기본: 첨부 유지, 제목만 변경
    let deleteOldAssets = [];

    if (videoUrl) {
      newTarget = videoUrl;
      if (newTarget !== editingLeaf.target) deleteOldAssets = extractAssetPaths(editingLeaf.target);
    } else if (videoFile) {
      const ext = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
      newTarget = `assets/video-${timestampSlug()}.${ext}`;
      setEditStatus('영상 업로드 중...');
      await ghPutBinaryBase64(newTarget, token, await fileToBase64(videoFile), `Replace video for "${title}"`);
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    } else if (docFile) {
      const ext = (docFile.name.split('.').pop() || 'pdf').toLowerCase();
      newTarget = `assets/doc-${timestampSlug()}.${ext}`;
      setEditStatus('문서 업로드 중...');
      await ghPutBinaryBase64(newTarget, token, await fileToBase64(docFile), `Replace document for "${title}"`);
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    } else if (imageFiles.length >= 1) {
      const slug = timestampSlug();
      setEditStatus(imageFiles.length > 1 ? `이미지 ${imageFiles.length}장 업로드 중...` : '이미지 업로드 중...');
      const paths = imageFiles.map((file, i) => {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        return `assets/img-${slug}-${i}.${ext}`;
      });
      await Promise.all(imageFiles.map(async (file, i) => {
        const base64 = await fileToBase64(file);
        await ghPutBinaryBase64(paths[i], token, base64, `Replace image ${i + 1}/${imageFiles.length} for "${title}"`);
      }));
      newTarget = `gallery.html?imgs=${encodeURIComponent(paths.join(','))}`;
      if (bodyText) {
        const textPath = `assets/text-${slug}.txt`;
        setEditStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Replace caption for "${title}"`);
        newTarget += `&text=${encodeURIComponent(textPath)}`;
      }
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    } else if (isGalleryPost) {
      // 새 이미지를 안 골랐으면 기존 이미지는 그대로 두고, 설명글만 새로 쓰거나(비우면) 지운다.
      if (bodyText) {
        const textPath = `assets/text-${timestampSlug()}.txt`;
        setEditStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Update caption for "${title}"`);
        newTarget = `gallery.html?imgs=${encodeURIComponent(existingGallery.imgs.join(','))}&text=${encodeURIComponent(textPath)}`;
      } else {
        newTarget = `gallery.html?imgs=${encodeURIComponent(existingGallery.imgs.join(','))}`;
      }
      if (existingGallery.textPath) deleteOldAssets = [existingGallery.textPath];
    } else if (bodyText) {
      newTarget = `assets/post-${timestampSlug()}.txt`;
      setEditStatus('글 파일 업로드 중...');
      await ghPutText(newTarget, token, bodyText, `Replace post text for "${title}"`);
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    }

    // archive.md는 업로드가 다 끝난 지금 시점에 최신 상태로 다시 읽어와서 고친다 —
    // 업로드하는 동안(특히 이미지 여러 장) 다른 저장이 먼저 반영됐을 수 있어서,
    // 미리 읽어둔 sha를 그대로 쓰면 409(충돌) 오류가 난다. 그래도 한 번 더 충돌하면
    // (거의 동시에 다른 저장이 겹친 경우) 한 번만 재시도한다.
    setEditStatus('archive.md 갱신 중...');
    for (let attempt = 0; ; attempt++) {
      const current = await ghGetFile('archive.md', token);
      if (!current) throw new Error('archive.md를 찾을 수 없습니다.');
      const lines = b64DecodeUtf8(current.content).split('\n');
      if (lines[editingLeaf.lineIndex] !== editingLeaf.lineText) {
        throw new Error('그 사이 내용이 바뀐 것 같습니다. 목록을 새로고침한 뒤 다시 시도해주세요.');
      }
      const newLine = `${' '.repeat(editingLeaf.indent)}${newTarget ? `- [${title}](${newTarget})` : `- ${title}`}`;
      lines[editingLeaf.lineIndex] = newLine;
      try {
        await ghPutText('archive.md', token, lines.join('\n'), `Edit "${editingLeaf.title}" -> "${title}"`, current.sha);
        break;
      } catch (e) {
        if (attempt === 0 && /\(409\)/.test(e.message)) continue;
        throw e;
      }
    }

    for (const oldPath of deleteOldAssets) {
      try { await deleteAsset(oldPath, token); } catch (e) { console.warn('이전 첨부 삭제 실패:', e); }
    }

    setEditStatus('저장 완료.', 'ok');
    els.editPanel.hidden = true;
    editingLeaf = null;
    await loadManageList();
  } catch (err) {
    setEditStatus(`오류: ${err.message}`, 'error');
  } finally {
    els.editSaveBtn.disabled = false;
  }
});

els.manageLevel1Select.addEventListener('change', updateManageLevel2);
els.manageLevel2Select.addEventListener('change', loadManageList);

(function init() {
  const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (saved) els.token.value = saved;
  refreshLevels();
})();

// ---------- 제출 ----------
els.form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const token = els.token.value.trim();
  if (!token) { setStatus('GitHub 토큰을 입력해주세요.', 'error'); return; }

  const level1 = els.level1Select.value === NEW_OPTION ? els.level1New.value.trim() : els.level1Select.value;
  const level2 = els.level2Select.value === NEW_OPTION ? els.level2New.value.trim() : els.level2Select.value;
  const level3Raw = els.level3Select.value;
  const level3 = level3Raw === NONE_OPTION ? '' : (level3Raw === NEW_OPTION ? els.level3New.value.trim() : level3Raw);
  const title = els.title.value.trim();
  const imageFiles = [...els.imageFile.files];
  const docFile = els.docFile.files[0];
  const videoFile = els.videoFile.files[0];
  const videoUrl = els.videoUrl.value.trim();
  const bodyText = els.bodyText.value.trim();

  if (!level1) { setStatus('1단계 항목 이름을 입력해주세요.', 'error'); return; }
  if (!level2) { setStatus('2단계 항목 이름을 입력해주세요.', 'error'); return; }
  if (level3Raw === NEW_OPTION && !level3) { setStatus('3단계 항목 이름을 입력해주세요.', 'error'); return; }
  if (!title) { setStatus('제목을 입력해주세요.', 'error'); return; }

  els.submitBtn.disabled = true;
  setStatus('업로드 중...');

  try {
    if (els.rememberToken.checked) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }

    // 여러 개를 채웠다면 영상 링크 → 영상 파일 → 문서 파일 → 이미지 → 글 순서로 하나만 사용한다.
    let linkTarget = null;

    if (videoUrl) {
      linkTarget = videoUrl;
    } else if (videoFile) {
      const ext = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
      linkTarget = `assets/video-${timestampSlug()}.${ext}`;
      setStatus('영상 업로드 중... (용량에 따라 시간이 걸릴 수 있습니다)');
      const base64 = await fileToBase64(videoFile);
      await ghPutBinaryBase64(linkTarget, token, base64, `Add video for "${title}"`);
    } else if (docFile) {
      const ext = (docFile.name.split('.').pop() || 'pdf').toLowerCase();
      linkTarget = `assets/doc-${timestampSlug()}.${ext}`;
      setStatus('문서 업로드 중...');
      const base64 = await fileToBase64(docFile);
      await ghPutBinaryBase64(linkTarget, token, base64, `Add document for "${title}"`);
    } else if (imageFiles.length >= 1) {
      // 이미지는 개수와 상관없이 항상 gallery.html로 연결한다(1장이어도 동일한 뷰어 사용).
      // 함께 적은 글이 있으면 이미지 옆에 보여줄 설명글로 같이 올린다.
      // 이미지끼리는 서로 다른 파일이라 한 장씩 순서대로 기다릴 필요가 없어서 동시에 올린다.
      const slug = timestampSlug();
      setStatus(imageFiles.length > 1 ? `이미지 ${imageFiles.length}장 업로드 중...` : '이미지 업로드 중...');
      const paths = imageFiles.map((file, i) => {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        return `assets/img-${slug}-${i}.${ext}`;
      });
      await Promise.all(imageFiles.map(async (file, i) => {
        const base64 = await fileToBase64(file);
        await ghPutBinaryBase64(paths[i], token, base64, `Add image ${i + 1}/${imageFiles.length} for "${title}"`);
      }));
      linkTarget = `gallery.html?imgs=${encodeURIComponent(paths.join(','))}`;
      if (bodyText) {
        const textPath = `assets/text-${slug}.txt`;
        setStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Add caption for "${title}"`);
        linkTarget += `&text=${encodeURIComponent(textPath)}`;
      }
    } else if (bodyText) {
      linkTarget = `assets/post-${timestampSlug()}.txt`;
      setStatus('글 파일 업로드 중...');
      await ghPutText(linkTarget, token, bodyText, `Add post text for "${title}"`);
    }

    setStatus('archive.md 갱신 중...');
    const leafLine = linkTarget ? `- [${title}](${linkTarget})` : `- ${title}`;
    const pathLabel = [level1, level2, level3].filter(Boolean).join(' / ');
    for (let attempt = 0; ; attempt++) {
      const current = await ghGetFile('archive.md', token);
      if (!current) throw new Error('archive.md 파일을 찾을 수 없습니다.');
      const currentText = b64DecodeUtf8(current.content);
      const updatedText = insertPost(currentText, { level1, level2, level3: level3 || null, leafLine });
      try {
        await ghPutText('archive.md', token, updatedText, `Add "${title}" under ${pathLabel}`, current.sha);
        break;
      } catch (e) {
        if (attempt === 0 && /\(409\)/.test(e.message)) continue;
        throw e;
      }
    }

    // 빨간 점 배지 기록은 게시물이 이미 다 올라간 뒤의 부가 기능이라, 완료 메시지를
    // 기다리게 하지 않고 백그라운드로 넘긴다(실패해도 게시물 자체엔 지장 없음).
    markUpdated([level1, level2, level3].filter(Boolean), token).catch((badgeErr) => {
      console.warn('업데이트 배지 기록 실패:', badgeErr);
    });

    setStatus(`완료! "${[level1, level2, level3].filter(Boolean).join(' > ')} > ${title}" 게시물이 추가됐습니다.\n1분 정도 후 사이트에 반영됩니다.`, 'ok');

    els.title.value = '';
    els.imageFile.value = '';
    els.docFile.value = '';
    els.videoFile.value = '';
    els.videoUrl.value = '';
    els.sizeWarning.style.display = 'none';
    els.bodyText.value = '';
    els.level1New.value = '';
    els.level2New.value = '';
    els.level3New.value = '';
    await refreshLevels();
    if ([...els.level1Select.options].some((o) => o.value === level1)) {
      els.level1Select.value = level1;
      updateLevel2Options();
      if ([...els.level2Select.options].some((o) => o.value === level2)) {
        els.level2Select.value = level2;
        updateLevel3Options();
        if (level3 && [...els.level3Select.options].some((o) => o.value === level3)) els.level3Select.value = level3;
      }
    }
  } catch (err) {
    setStatus(`오류: ${err.message}`, 'error');
  } finally {
    els.submitBtn.disabled = false;
  }
});
