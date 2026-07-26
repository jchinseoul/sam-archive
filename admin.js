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
  imageAlts: document.getElementById('imageAlts'),
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
  editImageAlts: document.getElementById('editImageAlts'),
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

async function ghPutText(path, token, text, message, sha, attempt = 0) {
  const body = { message, content: b64EncodeUtf8(text), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // sha 없이 새 파일을 만드는 경우(설명글·글 텍스트 등)만 재시도한다. sha를 넘긴 기존 파일
  // 수정(archive.md 등)은 호출한 쪽에서 최신 sha로 다시 읽어와 재시도하므로 여기선 건드리지 않는다.
  if (res.status === 409 && !sha && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    return ghPutText(path, token, text, message, sha, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path} 저장 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

async function ghPutBinaryBase64(path, token, base64Content, message, attempt = 0) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, branch: BRANCH }),
  });
  // 빠르게 연속으로 커밋하면 GitHub 쪽에서 아주 짧게 내부 정합성이 안 맞아 409가 날 때가 있다.
  // 이럴 땐 대개 조금만 기다렸다 같은 요청을 다시 보내면 풀린다.
  if (res.status === 409 && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    return ghPutBinaryBase64(path, token, base64Content, message, attempt + 1);
  }
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
  for (let attempt = 0; ; attempt++) {
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

    try {
      await ghPutText(
        UPDATES_FILE,
        token,
        JSON.stringify(list),
        `Mark updated: ${names.filter(Boolean).join(', ')}`,
        existing ? existing.sha : undefined,
      );
      return;
    } catch (e) {
      if (attempt < 3 && /\(409\)/.test(e.message)) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
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

// 목록을 불러온 뒤 다른 게시물을 추가/수정/삭제하면 이 게시물의 줄 번호가 밀릴 수 있다.
// lineIndex를 그대로 믿는 대신, 같은 경로(path)+제목으로 최신 내용에서 다시 찾아낸다.
function relocateLeaf(freshLines, level1, level2, leaf) {
  const l1 = findChild(freshLines, -1, 0, level1);
  const l2 = l1 && findChild(freshLines, l1.idx, l1.indent, level2);
  if (!l2) return null;
  const freshLeaves = collectLeaves(freshLines, l2.idx, l2.indent, []);
  return freshLeaves.find((l) => l.title === leaf.title && JSON.stringify(l.path) === JSON.stringify(leaf.path)) || null;
}

// archive.md에 쓰는 모든 곳(추가/수정/삭제)이 공통으로 쓰는 읽기-수정-쓰기 헬퍼.
// 매번 최신 내용을 다시 읽어와 applyFn으로 고친 뒤 저장하고, 저장이 409로 실패하면
// (거의 동시에 다른 저장이 겹쳤거나 GitHub 쪽이 아주 짧게 정합성이 안 맞을 때) 조금씩
// 기다렸다 최신 내용을 다시 읽어와서 재시도한다.
// applyFn(text) => { text, message } — 게시물을 못 찾는 등 더 진행할 수 없으면 applyFn이
// 직접 에러를 던지면 되고, 그 에러는 재시도 없이 바로 위로 전달된다.
async function updateArchiveMd(token, applyFn) {
  for (let attempt = 0; ; attempt++) {
    const current = await ghGetFile('archive.md', token);
    if (!current) throw new Error('archive.md를 찾을 수 없습니다.');
    const currentText = b64DecodeUtf8(current.content);
    const built = applyFn(currentText);
    try {
      await ghPutText('archive.md', token, built.text, built.message, current.sha);
      return;
    } catch (e) {
      if (attempt < 3 && /\(409\)/.test(e.message)) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

// 이미지별 대체 텍스트(alts)는 콤마 대신 이 구분자로 잇는다. 설명 글에 콤마가
// 들어있어도 안 깨지도록. gallery.html의 ALT_SEP과 반드시 같은 값이어야 한다.
const ALT_SEP = String.fromCharCode(31);

// gallery.html?imgs=...&alts=...&video=...&text=... 링크에서 이미지/설명/영상/설명글 경로를 뽑아낸다.
function parseGalleryTarget(target) {
  const sp = new URLSearchParams(target.split('?')[1] || '');
  const imgs = (sp.get('imgs') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const alts = sp.has('alts') ? sp.get('alts').split(ALT_SEP) : [];
  const video = sp.get('video') || null;
  const textPath = sp.get('text') || null;
  return { imgs, alts, video, textPath };
}

// { imgs, alts, video, textPath } 중 있는 것만으로 gallery.html 링크를 만든다.
// alts는 imgs와 같은 순서의 배열이며, 전부 비어있으면 파라미터 자체를 생략한다.
function buildGalleryTarget({ imgs, alts, video, textPath }) {
  const sp = new URLSearchParams();
  if (imgs && imgs.length) sp.set('imgs', imgs.join(','));
  if (alts && alts.some((a) => (a || '').trim())) sp.set('alts', alts.map((a) => (a || '').trim()).join(ALT_SEP));
  if (video) sp.set('video', video);
  if (textPath) sp.set('text', textPath);
  return `gallery.html?${sp.toString()}`;
}

// 대체 텍스트 입력칸(줄바꿈으로 구분)을 이미지 개수만큼의 배열로 만든다.
function parseAltsInput(text, count) {
  const lines = (text || '').split('\n');
  return Array.from({ length: count }, (_, i) => (lines[i] || '').trim());
}

// 게시물의 첨부(target)가 가리키는 assets/ 파일 경로 목록을 뽑아낸다.
// 외부 링크(영상 URL 등)나 첨부 없음이면 빈 배열.
function extractAssetPaths(target) {
  if (!target) return [];
  if (/^https?:\/\//.test(target)) return [];
  if (target.startsWith('gallery.html?')) {
    const { imgs, video, textPath } = parseGalleryTarget(target);
    const paths = [...imgs];
    if (video && !/^https?:\/\//.test(video)) paths.push(video);
    if (textPath) paths.push(textPath);
    return paths;
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

// "2025-02-02"처럼 제목이 날짜 형태인지 판단한다.
function looksLikeDateTitle(title) {
  return /^\d{4}-\d{2}-\d{2}$/.test((title || '').trim());
}

// "- [제목](링크)" 또는 "- 제목" 한 줄에서 제목만 뽑아낸다.
function extractLeafTitle(leafLine) {
  const m = leafLine.match(/^-\s+\[(.+)\]\(.+\)$/) || leafLine.match(/^-\s+(.*)$/);
  return m ? (m[1] || '').trim() : '';
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

  // 제목이 날짜 형태면, 같은 자리의 다른 날짜 제목들 사이에서 정렬된 위치를 찾는다
  // (그 외 형태의 제목은 예전처럼 그냥 맨 끝에 추가).
  let insertAt = leafEnd;
  const newTitle = extractLeafTitle(leafLine);
  if (looksLikeDateTitle(newTitle)) {
    for (let i = parent.idx + 1; i < leafEnd; i++) {
      if (!lines[i].trim()) continue;
      if (indentOf(lines[i]) !== leafIndent) continue;
      const m = lines[i].match(/^\s*-\s+(.*)$/);
      if (!m) continue;
      const siblingTitle = extractLeafTitle(`- ${m[1]}`);
      if (!looksLikeDateTitle(siblingTitle)) continue;
      if (newTitle < siblingTitle) { insertAt = i; break; }
    }
  }

  lines.splice(insertAt, 0, `${' '.repeat(leafIndent)}${leafLine}`);
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

  const level1 = els.manageLevel1Select.value;
  const level2 = els.manageLevel2Select.value;

  btnEl.disabled = true;
  setManageStatus(`"${leaf.title}" 삭제 중...`);
  try {
    await updateArchiveMd(token, (currentText) => {
      const lines = currentText.split('\n');
      const fresh = relocateLeaf(lines, level1, level2, leaf);
      if (!fresh) throw new Error('게시물을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.');
      lines.splice(fresh.lineIndex, 1);
      return { text: lines.join('\n'), message: `Delete "${leaf.title}"` };
    });

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

async function openEdit(index) {
  const leaf = manageLeaves[index];
  editingLeaf = leaf;
  els.editTitle.value = leaf.title;
  els.editImageFile.value = '';
  els.editImageAlts.value = '';
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
    const { imgs, alts, video, textPath } = parseGalleryTarget(target);
    if (imgs.length) {
      els.editCurrentHint.textContent = `현재 이미지 ${imgs.length}장 — 아래 "글 내용"만 고치면 이미지는 그대로 유지됩니다. 새 이미지를 고르지 않으면 아래 "이미지 설명"도 무시되고 기존 설명이 그대로 유지됩니다.`;
      imgs.forEach((src) => {
        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'max-height:110px;max-width:140px;object-fit:cover;border-radius:6px;margin:0 .4rem .4rem 0;';
        els.editCurrentPreview.append(img);
      });
      els.editImageAlts.value = imgs.map((_, i) => alts[i] || '').join('\n');
    } else if (video) {
      const isExternal = /^https?:\/\//.test(video);
      els.editCurrentHint.textContent = `현재 영상 ${isExternal ? '링크' : '파일'} — 아래 "글 내용"만 고치면 영상은 그대로 유지됩니다.`;
      if (isExternal) {
        const a = document.createElement('a');
        a.href = video;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = video;
        els.editCurrentPreview.append(a);
      } else {
        const v = document.createElement('video');
        v.src = video;
        v.controls = true;
        v.style.cssText = 'max-height:140px;border-radius:6px;';
        els.editCurrentPreview.append(v);
      }
    } else {
      els.editCurrentHint.textContent = '현재 글만 있는 항목 — 아래에 그대로 채워둠:';
    }
    if (textPath) {
      try {
        const res = await fetch(`${textPath}?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) els.editBodyText.value = await res.text();
      } catch { /* 설명글을 못 불러와도 나머지는 이미 보여줬으니 무시 */ }
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
      let textPath = null;
      if (bodyText) {
        textPath = `assets/text-${timestampSlug()}.txt`;
        setEditStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Replace caption for "${title}"`);
      }
      newTarget = buildGalleryTarget({ video: videoUrl, textPath });
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    } else if (videoFile) {
      const ext = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
      const videoPath = `assets/video-${timestampSlug()}.${ext}`;
      setEditStatus('영상 업로드 중...');
      await ghPutBinaryBase64(videoPath, token, await fileToBase64(videoFile), `Replace video for "${title}"`);
      let textPath = null;
      if (bodyText) {
        textPath = `assets/text-${timestampSlug()}.txt`;
        setEditStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Replace caption for "${title}"`);
      }
      newTarget = buildGalleryTarget({ video: videoPath, textPath });
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    } else if (docFile) {
      const ext = (docFile.name.split('.').pop() || 'pdf').toLowerCase();
      newTarget = `assets/doc-${timestampSlug()}.${ext}`;
      setEditStatus('문서 업로드 중...');
      await ghPutBinaryBase64(newTarget, token, await fileToBase64(docFile), `Replace document for "${title}"`);
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    } else if (imageFiles.length >= 1) {
      // 여러 장을 동시에 올리면 GitHub 쪽에서 같은 브랜치에 커밋이 충돌(409)해서,
      // 한 장씩 순서대로 올린다.
      const slug = timestampSlug();
      const paths = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `assets/img-${slug}-${i}.${ext}`;
        setEditStatus(imageFiles.length > 1 ? `이미지 업로드 중... (${i + 1}/${imageFiles.length})` : '이미지 업로드 중...');
        const base64 = await fileToBase64(file);
        await ghPutBinaryBase64(path, token, base64, `Replace image ${i + 1}/${imageFiles.length} for "${title}"`);
        paths.push(path);
      }
      let textPath = null;
      if (bodyText) {
        textPath = `assets/text-${slug}.txt`;
        setEditStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Replace caption for "${title}"`);
      }
      const alts = parseAltsInput(els.editImageAlts.value, paths.length);
      newTarget = buildGalleryTarget({ imgs: paths, alts, textPath });
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    } else if (isGalleryPost) {
      // 새 이미지/영상을 안 골랐으면 기존 미디어(이미지 또는 영상)는 그대로 두고,
      // 설명글만 새로 쓰거나(비우면) 지운다. 이미지 설명(alt)도 기존 값을 그대로 지킨다.
      let textPath = null;
      if (bodyText) {
        textPath = `assets/text-${timestampSlug()}.txt`;
        setEditStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Update caption for "${title}"`);
      }
      newTarget = buildGalleryTarget({
        imgs: existingGallery.imgs,
        alts: existingGallery.alts,
        video: existingGallery.video,
        textPath,
      });
      if (existingGallery.textPath) deleteOldAssets = [existingGallery.textPath];
    } else if (bodyText) {
      const textPath = `assets/post-${timestampSlug()}.txt`;
      setEditStatus('글 파일 업로드 중...');
      await ghPutText(textPath, token, bodyText, `Replace post text for "${title}"`);
      newTarget = buildGalleryTarget({ textPath });
      deleteOldAssets = extractAssetPaths(editingLeaf.target);
    }

    // archive.md는 업로드가 다 끝난 지금 시점에 최신 상태로 다시 읽어와서 고친다.
    setEditStatus('archive.md 갱신 중...');
    const editLevel1 = els.manageLevel1Select.value;
    const editLevel2 = els.manageLevel2Select.value;
    await updateArchiveMd(token, (currentText) => {
      const lines = currentText.split('\n');
      const fresh = relocateLeaf(lines, editLevel1, editLevel2, editingLeaf);
      if (!fresh) throw new Error('게시물을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.');
      const leafContent = newTarget ? `- [${title}](${newTarget})` : `- ${title}`;
      // 수정 후 제목이 날짜 형태면, 제자리 교체 대신 한 번 빼냈다가 날짜 순서에 맞는
      // 위치로 다시 끼워 넣는다(새 게시물 추가할 때와 동일한 정렬 규칙).
      if (looksLikeDateTitle(title)) {
        lines.splice(fresh.lineIndex, 1);
        const updatedText = insertPost(lines.join('\n'), {
          level1: editLevel1,
          level2: editLevel2,
          level3: fresh.path && fresh.path[0] ? fresh.path[0] : null,
          leafLine: leafContent,
        });
        return { text: updatedText, message: `Edit "${editingLeaf.title}" -> "${title}"` };
      }
      const newLine = `${' '.repeat(fresh.indent)}${leafContent}`;
      lines[fresh.lineIndex] = newLine;
      return { text: lines.join('\n'), message: `Edit "${editingLeaf.title}" -> "${title}"` };
    });

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
      let textPath = null;
      if (bodyText) {
        textPath = `assets/text-${timestampSlug()}.txt`;
        setStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Add caption for "${title}"`);
      }
      linkTarget = buildGalleryTarget({ video: videoUrl, textPath });
    } else if (videoFile) {
      const ext = (videoFile.name.split('.').pop() || 'mp4').toLowerCase();
      const videoPath = `assets/video-${timestampSlug()}.${ext}`;
      setStatus('영상 업로드 중... (용량에 따라 시간이 걸릴 수 있습니다)');
      const base64 = await fileToBase64(videoFile);
      await ghPutBinaryBase64(videoPath, token, base64, `Add video for "${title}"`);
      let textPath = null;
      if (bodyText) {
        textPath = `assets/text-${timestampSlug()}.txt`;
        setStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Add caption for "${title}"`);
      }
      linkTarget = buildGalleryTarget({ video: videoPath, textPath });
    } else if (docFile) {
      const ext = (docFile.name.split('.').pop() || 'pdf').toLowerCase();
      linkTarget = `assets/doc-${timestampSlug()}.${ext}`;
      setStatus('문서 업로드 중...');
      const base64 = await fileToBase64(docFile);
      await ghPutBinaryBase64(linkTarget, token, base64, `Add document for "${title}"`);
    } else if (imageFiles.length >= 1) {
      // 이미지는 개수와 상관없이 항상 gallery.html로 연결한다(1장이어도 동일한 뷰어 사용).
      // 함께 적은 글이 있으면 이미지 옆에 보여줄 설명글로 같이 올린다.
      // GitHub Contents API는 파일 하나당 커밋을 하나씩 만들기 때문에, 여러 장을
      // 동시에 올리면 같은 브랜치에 동시에 커밋하려다 서로 충돌(409)한다.
      // 그래서 조금 느리더라도 한 장씩 순서대로 올린다.
      const slug = timestampSlug();
      const paths = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `assets/img-${slug}-${i}.${ext}`;
        setStatus(imageFiles.length > 1 ? `이미지 업로드 중... (${i + 1}/${imageFiles.length})` : '이미지 업로드 중...');
        const base64 = await fileToBase64(file);
        await ghPutBinaryBase64(path, token, base64, `Add image ${i + 1}/${imageFiles.length} for "${title}"`);
        paths.push(path);
      }
      let textPath = null;
      if (bodyText) {
        textPath = `assets/text-${slug}.txt`;
        setStatus('설명 글 업로드 중...');
        await ghPutText(textPath, token, bodyText, `Add caption for "${title}"`);
      }
      const alts = parseAltsInput(els.imageAlts.value, paths.length);
      linkTarget = buildGalleryTarget({ imgs: paths, alts, textPath });
    } else if (bodyText) {
      const textPath = `assets/post-${timestampSlug()}.txt`;
      setStatus('글 파일 업로드 중...');
      await ghPutText(textPath, token, bodyText, `Add post text for "${title}"`);
      linkTarget = buildGalleryTarget({ textPath });
    }

    setStatus('archive.md 갱신 중...');
    const leafLine = linkTarget ? `- [${title}](${linkTarget})` : `- ${title}`;
    const pathLabel = [level1, level2, level3].filter(Boolean).join(' / ');
    await updateArchiveMd(token, (currentText) => {
      const updatedText = insertPost(currentText, { level1, level2, level3: level3 || null, leafLine });
      return { text: updatedText, message: `Add "${title}" under ${pathLabel}` };
    });

    // 배경 처리로 두면 완료 메시지를 보자마자 탭을 닫을 때 이 요청이 끊겨 배지가
    // 아예 안 남을 수 있어서, 조금 기다리더라도 여기서 끝까지 마친다.
    setStatus('업데이트 표시 기록 중...');
    try {
      await markUpdated([level1, level2, level3].filter(Boolean), token);
    } catch (badgeErr) {
      console.warn('업데이트 배지 기록 실패:', badgeErr);
    }

    setStatus(`완료! "${[level1, level2, level3].filter(Boolean).join(' > ')} > ${title}" 게시물이 추가됐습니다.\n1분 정도 후 사이트에 반영됩니다.`, 'ok');

    els.title.value = '';
    els.imageFile.value = '';
    els.imageAlts.value = '';
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
