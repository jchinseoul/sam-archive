// ============================================================
// 문학회 매거진 아카이브 — SAM ARCHIVE를 중심으로 사방(360도)에 뻗어나가는 마인드맵
// markmap 대신 d3.hierarchy + d3.tree(방사형)를 직접 사용합니다.
// 앞으로 이 파일은 다시 건드릴 필요가 없습니다. (수정 대상은 archive.md만)
// ============================================================

(async () => {
  // ---------- 0. 설정값 ----------
  const RADIUS = 11;                 // 원 크기 (더 크게)
  // 태양(루트) 바로 다음 단계(depth 1, "태양계" 행성들)의 간격과, 그 아래(depth 2+,
  // 위성/게시물)의 간격을 따로 둔다 — "태양계 간격은 그대로, 그 아래만 좁혀달라"는
  // 요청에 맞춰 depth 1은 넉넉하게, depth 2부터는 훨씬 좁게 잡는다.
  const NODE_DY_OUTER = 130;          // depth 1(태양계 행성)의 부모-자식 간 반지름 간격
  const NODE_DY_INNER = 45;           // depth 2 이상(위성/게시물)의 부모-자식 간 반지름 간격
  const nodeGap = (d) => (d.depth === 1 ? NODE_DY_OUTER : NODE_DY_INNER);
  const ROOT_CLEARANCE = 85;          // 태양(루트) 로고와 겹치지 않도록 depth 1 노드에게 주는 최소 거리
  const MAX_DEPTH = 3;                // 호수(1) → 유형(2) → 게시물(3)
  const INITIAL_VISIBLE_DEPTH = 0;    // 처음엔 중심 글자(루트)만 보여주고, 클릭하면 가지가 뻗어나옴
  const PLANET_R_MIN = 2;             // 콘텐츠가 적은(리프) 노드의 "행성" 반지름
  const PLANET_R_MAX = 9;             // 콘텐츠가 많은(하위 항목이 많은) 노드의 "행성" 반지름
  const ORBIT_ANGULAR_K = 8;          // 공전 속도 상수. 반지름(y)이 작을수록(안쪽 궤도) 더 빠르게 돈다
  const FOCUS_DISTANCE_BOOST = 300;   // 펼쳐진 노드를 자기 부모(태양계)로부터 이만큼 더 끌어내 놓는다

  // 배경이 흰색(밝은 테마)일 땐 밝은 배경에 어울리는 로고를, 어두운 테마일 땐 기존 로고를 쓴다.
  // theme.js가 사용자가 버튼으로 직접 고른 테마까지 감안해 판단해준다(없으면 시스템 설정).
  const lightSchemeQuery = window.matchMedia('(prefers-color-scheme: light)');
  const currentLogoHref = () => {
    const effective = window.samTheme ? window.samTheme.effectiveTheme() : (lightSchemeQuery.matches ? 'light' : 'dark');
    return effective === 'light' ? 'logo-light.png' : 'logo.png';
  };

  // gallery.html 링크를 열 때 이 노드의 이름(=제목)을 title 파라미터로 실어 보낸다.
  // archive.md에 예전에 올라온 게시물도(admin.js가 title을 저장하기 전 것도) 열 때마다
  // 항상 현재 이름으로 제목이 뜨게 하기 위해, 저장된 값에 기대지 않고 여기서 매번 채운다.
  function withGalleryTitle(url, name) {
    if (!url || !url.startsWith('gallery.html')) return url;
    const [path, query = ''] = url.split('?');
    const sp = new URLSearchParams(query);
    sp.set('title', name);
    return `${path}?${sp.toString()}`;
  }

  // 클릭한 노드는 그 자리에 완전히 멈춰 세운다(나머지 노드는 계속 공전한다).
  const pausedNodes = new Set();

  // 노드를 펼친 순서를 기록해 뒤로가기/앞으로 가기(undo/redo)에 사용한다.
  // historyPos는 "현재 적용된 펼치기 개수"를 가리키며, 이보다 뒤쪽(historyPos 이후)은
  // 아직 안 펼쳐졌거나(뒤로가기로 되돌아간) "다시 갈 수 있는" 상태다.
  let expandHistory = [];
  let historyPos = 0;

  // 실제 태양계 행성 색을 흉내낸 팔레트. 태양(루트) 바로 다음 단계(depth 1)의
  // 노드마다 등장 순서대로 하나씩 배정하고(수성→금성→지구→...), 그 아래(달/위성 격인
  // depth 2, 3)는 자기 행성 색을 흰색 쪽으로 옅게 섞어 "같은 행성 계열의 위성"처럼 보이게 한다.
  const PLANET_PALETTE = ['#b1aaa3', '#d9b38c', '#4f83cc', '#c1440e', '#c9974b', '#e3c16f', '#7fd4d1', '#4169e1'];
  function planetColorOf(d) {
    if (d.depth === 0) return '#fff';
    let ancestor = d;
    while (ancestor.depth > 1) ancestor = ancestor.parent;
    const siblings = root.data.children || [];
    const idx = Math.max(0, siblings.indexOf(ancestor.data));
    const base = PLANET_PALETTE[idx % PLANET_PALETTE.length];
    const moonMix = d.depth === 1 ? 0 : d.depth === 2 ? 0.45 : 0.7;
    return moonMix === 0 ? base : d3.interpolateRgb(base, '#ffffff')(moonMix);
  }

  // ---------- 1. archive.md → 계층 데이터 파싱 ----------
  const res = await fetch('archive.md', { cache: 'no-store' });
  const markdown = await res.text();

  // updates.json: admin.html에서 글을 올릴 때마다 "이 카테고리가 방금 업데이트됐다"고
  // 기록해두는 파일. 없어도(아직 한 번도 안 썼으면) 에러 없이 그냥 빈 목록으로 취급한다.
  const NEW_BADGE_MS = 7 * 24 * 60 * 60 * 1000; // 7일 동안 빨간 점 표시
  let lastUpdatedAt = new Map();
  try {
    const updatesRes = await fetch('updates.json', { cache: 'no-store' });
    if (updatesRes.ok) {
      const list = await updatesRes.json();
      list.forEach((entry) => {
        if (!entry || !entry.name || typeof entry.at !== 'number') return;
        const prev = lastUpdatedAt.get(entry.name);
        if (!prev || entry.at > prev) lastUpdatedAt.set(entry.name, entry.at);
      });
    }
  } catch {
    // updates.json이 없거나 형식이 이상해도 배지만 안 보일 뿐, 마인드맵 자체는 정상 작동해야 한다.
  }
  // 빨간 점을 "확인"하면(그 카테고리를 클릭하면) 사라지게 한다. 서버가 없는 정적
  // 사이트라 이 브라우저에서 확인했는지만 localStorage에 기억한다(방문자 전체 공용 아님).
  // 확인한 뒤에 그 카테고리에 또 새 글이 올라오면(더 최신 at) 배지가 다시 뜬다.
  const SEEN_KEY = 'sam_archive_seen_updates';
  let seenMap = {};
  try { seenMap = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { seenMap = {}; }
  function isRecentlyUpdated(name) {
    const at = lastUpdatedAt.get(name);
    if (typeof at !== 'number' || Date.now() - at >= NEW_BADGE_MS) return false;
    return !(typeof seenMap[name] === 'number' && seenMap[name] >= at);
  }
  function markUpdateSeen(name) {
    const at = lastUpdatedAt.get(name);
    if (typeof at !== 'number' || seenMap[name] === at) return;
    seenMap[name] = at;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seenMap)); } catch { /* 저장 실패해도 배지만 계속 보일 뿐, 무시 */ }
  }

  function parseMarkdown(md) {
    const lines = md.split('\n');
    const rootLine = lines.find((l) => l.trim().startsWith('#'));
    const rootName = rootLine ? rootLine.replace(/^#+\s*/, '').trim() : '아카이브';

    const root = { name: rootName, url: null, children: [] };
    const stack = [{ node: root, indent: -1 }];
    const linkRe = /^\[(.+)\]\((.+)\)$/;

    for (const raw of lines) {
      const m = raw.match(/^(\s*)-\s+(.*)$/);
      if (!m) continue;
      const indent = m[1].replace(/\t/g, '  ').length;
      const level = Math.floor(indent / 2);
      const content = m[2].trim();

      let name = content;
      let url = null;
      const linkMatch = content.match(linkRe);
      if (linkMatch) {
        name = linkMatch[1];
        url = linkMatch[2];
      }

      const node = { name, url, children: [] };

      while (stack.length && stack[stack.length - 1].indent >= level) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(node);
      stack.push({ node, indent: level });
    }
    return root;
  }

  const data = parseMarkdown(markdown);

  // ---------- 2. d3 계층 (SAM ARCHIVE를 중심으로 사방 360도 펼침) ----------
  const root = d3.hierarchy(data);

  // 접기 전에 "원래 하위 트리 크기"를 노드마다 미리 저장해둔다 (자기 자신 포함).
  // 나중에 접혔다 펼쳐졌다 해도 이 값은 안 바뀌어야 하므로 collapseBeyond보다 먼저 계산.
  root.each((d) => { d.__fullSize = d.descendants().length; });

  // "행성" 크기 차등: 하위 콘텐츠가 많을수록(=__fullSize가 클수록) 큰 원으로 그린다.
  const maxFullSize = d3.max(root.descendants().filter((d) => d.depth > 0), (d) => d.__fullSize) || 1;
  const planetRadius = d3.scaleSqrt().domain([1, maxFullSize]).range([PLANET_R_MIN, PLANET_R_MAX]).clamp(true);

  // 처음엔 INITIAL_VISIBLE_DEPTH보다 깊은 노드는 접어둠
  function collapseBeyond(node, depth) {
    if (!node.children) return;
    if (depth >= INITIAL_VISIBLE_DEPTH) {
      node._children = node.children;
      node._children.forEach((c) => collapseBeyond(c, depth + 1));
      node.children = null;
    } else {
      node.children.forEach((c) => collapseBeyond(c, depth + 1));
    }
  }
  collapseBeyond(root, 0);

  // ---------- 3. SVG / 줌·팬 준비 ----------
  const svg = d3.select('#tree');
  const g = svg.append('g');

  // 가지 끝(리프 쪽)에 밝게 빛나는 효과를 주기 위한 블러 필터.
  svg.append('defs').append('filter')
    .attr('id', 'branchGlow')
    .attr('x', '-300%').attr('y', '-300%').attr('width', '700%').attr('height', '700%')
    .html('<feGaussianBlur stdDeviation="2.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>');

  const zoomBehavior = d3.zoom()
    .scaleExtent([0.3, 24]) // 노드를 펼칠 때마다 확대해 들어가므로 최대 배율을 넉넉히 둔다
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoomBehavior);

  function fit() {
    const bounds = g.node().getBBox();
    const svgRect = svg.node().getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    const padding = 60;
    const scale = Math.min(
      (svgRect.width - padding) / bounds.width,
      (svgRect.height - padding) / bounds.height,
      1.4
    );
    const tx = svgRect.width / 2 - scale * (bounds.x + bounds.width / 2);
    const ty = svgRect.height / 2 - scale * (bounds.y + bounds.height / 2); // 사방으로 퍼지므로 화면 정중앙에 고정

    svg.transition().duration(400).call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  }

  // ---------- 4. 렌더링 ----------
  // d.x/d.y는 이제 "자기 부모로부터"의 각도·거리(로컬)다. 태양(루트)만 화면 중심(0,0)에
  // 고정되고, 그 아래 모든 노드는 부모의 절대 좌표 + 이 로컬 오프셋으로 위치가 정해진다
  // (행성이 태양을 돌고, 그 위성은 행성을 도는 것과 같은 구조).
  const cartesianX = (d) => d.y * Math.sin(d.x);
  const cartesianY = (d) => -d.y * Math.cos(d.x);

  // 부모→자식 순서로 내려가며 절대 좌표(__ax, __ay)를 누적 계산한다.
  function computeAbsolutePositions() {
    root.eachBefore((d) => {
      if (!d.parent) {
        d.__ax = 0;
        d.__ay = 0;
        return;
      }
      d.__ax = d.parent.__ax + cartesianX(d);
      d.__ay = d.parent.__ay + cartesianY(d);
    });
  }
  const absX = (d) => d.__ax;
  const absY = (d) => d.__ay;
  const nodeTransform = (d) => `translate(${absX(d)},${absY(d)})`;

  // 클릭한 글자(노드)를 화면 정중앙으로 옮긴다. 방금 펼쳐서 하위 노드가 보이게 된
  // 노드라면, 그 하위 노드들이 전부 화면 안에 들어오도록(한눈에 보이도록) 배율을 계산해서
  // 확대·축소하고, 접을 때나 루트를 누를 때는 배율을 그대로 둔다.
  function centerOnNode(d, { zoomIn = false } = {}) {
    const svgRect = svg.node().getBoundingClientRect();
    const currentScale = d3.zoomTransform(svg.node()).k;
    const [minScale, maxScale] = zoomBehavior.scaleExtent();
    let targetScale;
    if (zoomIn) {
      // d를 중심에 두고, 새로 보이는 자식들 중 가장 먼 것까지 화면 안에 들어오는 배율을 구한다.
      let maxDist = 0;
      (d.children || []).forEach((c) => {
        const dx = absX(c) - absX(d);
        const dy = absY(c) - absY(d);
        maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
      });
      const padding = 100;
      const availableRadius = Math.min(svgRect.width, svgRect.height) / 2 - padding;
      targetScale = maxDist > 0
        ? Math.min(availableRadius / maxDist, maxScale)
        : Math.min(currentScale * 1.3, maxScale);
      targetScale = Math.max(minScale, targetScale);
    } else {
      targetScale = Math.max(minScale, Math.min(currentScale, maxScale));
    }
    const tx = svgRect.width / 2 - targetScale * absX(d);
    const ty = svgRect.height / 2 - targetScale * absY(d);
    svg.transition().duration(600).call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(tx, ty).scale(targetScale)
    );
  }

  // 노드마다 항상 같은 값이 나오는 의사난수(0~1) — 매번 다시 그려도 흔들리지 않으면서
  // 가지 길이·각도가 자연스럽게 들쭉날쭉해 보이게 만드는 용도.
  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }
  const ANGLE_JITTER = 0.8;       // 라디안, 약 ±23도 (형제가 정확히 균등 분배 각도에 딱 붙지 않도록)
  const RADIUS_JITTER = 0.22;     // 기본 궤도 간격 대비 비율, 약 ±22%

  // 노드가 "자기 부모를 도는" 로컬 각도. 같은 부모를 둔 형제끼리 0~2π를 균등하게
  // 나눠 가지므로, 트리 전체에서 어느 위치에 있든 항상 부모를 완전히 한 바퀴
  // 둘러싸며 퍼진다(트리 레이아웃이 배분한 전역 각도를 그대로 쓰면 한쪽으로 쏠릴 수 있다).
  function siblingAngle(d) {
    if (!d.parent) return 0;
    const siblings = d.parent.children || [d];
    const idx = Math.max(0, siblings.indexOf(d));
    const count = siblings.length;
    const parent = d.parent;
    const parentKey = parent.data.name + '-' + parent.depth + '-' + (parent.parent ? parent.parent.data.name : '');
    const rotationOffset = hash01(parentKey + '#rot') * 2 * Math.PI;
    return (idx / count) * 2 * Math.PI + rotationOffset;
  }

  // "연관도"의 대리 지표: 이 노드의 하위 트리가 부모의 하위 트리에서 차지하는
  // 비중. 부모 아래 콘텐츠의 큰 부분을 차지할수록(=구조적으로 강하게 연결될수록)
  // 연관도가 높다고 보고 가지를 짧게, 부모 대비 비중이 작은(곁가지성) 항목은
  // 가지를 길게 만든다. __fullSize는 접기 전에 미리 계산해둔 값이라 펼침 상태와
  // 무관하게 항상 같다.
  function relevance(d) {
    if (!d.parent) return 0;
    return Math.min(1, d.__fullSize / d.parent.__fullSize);
  }
  const RELEVANCE_SHRINK = 0.25; // 연관도가 1일 때 반지름을 최대 25%까지만 줄임(너무 붙지 않게)
  const TRANSITION_MS = 450;     // 가지가 펼쳐지는 애니메이션 시간

  // 글씨 크기: 루트 36px → 1단계(호수) 20px → 2단계(세 번째 항목)부터는 13px로 통일
  function fontSizeFor(depth) {
    if (depth === 0) return '36px';
    if (depth === 1) return '20px';
    return '13px';
  }
  const fontPxFor = (depth) => (depth === 0 ? 36 : depth === 1 ? 20 : 13);

  // ---------- 라벨 겹침 방지 ----------
  // 라벨은 항상 수평으로 그려지므로, 방사형 레이아웃의 각도 배분만으로는 물리적 겹침을
  // 막을 수 없다. 실제 텍스트 폭을 측정해서, 겹치는 라벨 쌍을 반복적으로 살짝 밀어낸다.
  // 직전 프레임에도 보이던 라벨(previousKeys)은 거의 그대로 두고, 이번에 새로 나타난
  // 라벨을 더 크게 밀어내서 "펼칠 때 기존 글자와 겹치지 않게" 만든다.
  const measureCtx = document.createElement('canvas').getContext('2d');
  const LABEL_FONT_FAMILY = '-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  function textWidth(text, fontPx) {
    measureCtx.font = `${fontPx}px ${LABEL_FONT_FAMILY}`;
    return measureCtx.measureText(text).width;
  }

  let previousKeys = new Set();
  const keyOf = (d) => d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : '');

  const OVERLAP_PAD = 10;         // 라벨 사이 최소 여백(px)
  const OVERLAP_ITERATIONS = 400; // 겹침 해소 반복 횟수(노드 수가 적어 400번 반복해도 수 ms 이내)

  // 겹침 해소는 절대 좌표(화면 픽셀) 기준으로 판단하지만, d.x/d.y는 "자기 부모로부터의"
  // 로컬 각도·거리이므로 절대 좌표 이동분을 부모 기준 로컬 값으로 바꿔서 저장한다.
  function applyCartesian(d, absCx, absCy) {
    const parentAx = d.parent ? d.parent.__ax : 0;
    const parentAy = d.parent ? d.parent.__ay : 0;
    const cx = absCx - parentAx;
    const cy = absCy - parentAy;
    const r = Math.sqrt(cx * cx + cy * cy);
    if (r < 1e-6) return; // 중심으로 완전히 붕괴하는 것만 방지
    d.y = Math.max(r, nodeGap(d) * 0.3);
    d.x = Math.atan2(cx, -cy);
  }
  function shiftCartesian(d, dCx, dCy) {
    applyCartesian(d, absX(d) + dCx, absY(d) + dCy);
  }

  function resolveLabelOverlaps(nodesArr) {
    const items = nodesArr.map((d) => {
      const fontPx = fontPxFor(d.depth);
      return {
        d,
        weight: d.depth === 0 ? 0 : (previousKeys.has(keyOf(d)) ? 0.12 : 1),
        halfW: textWidth(d.data.name, fontPx) / 2 + OVERLAP_PAD,
        halfH: fontPx * 0.65 + OVERLAP_PAD,
        labelDy: fontPx * 1.1, // 라벨은 노드 지점보다 위쪽에 그려짐(dy=-1.1em)
      };
    });

    for (let iter = 0; iter < OVERLAP_ITERATIONS; iter++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const ax = absX(a.d);
          const ay = absY(a.d) - a.labelDy;
          const bx = absX(b.d);
          const by = absY(b.d) - b.labelDy;
          let dx = bx - ax;
          let dy = by - ay;
          const overlapX = a.halfW + b.halfW - Math.abs(dx);
          const overlapY = a.halfH + b.halfH - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;

          const totalW = a.weight + b.weight;
          if (totalW === 0) continue;
          if (dx === 0 && dy === 0) dx = 0.001;

          moved = true;
          if (overlapX < overlapY) {
            const sign = dx >= 0 ? 1 : -1;
            const push = overlapX + 0.5;
            shiftCartesian(a.d, -sign * push * (a.weight / totalW), 0);
            shiftCartesian(b.d, sign * push * (b.weight / totalW), 0);
          } else {
            const sign = dy >= 0 ? 1 : -1;
            const push = overlapY + 0.5;
            shiftCartesian(a.d, 0, -sign * push * (a.weight / totalW));
            shiftCartesian(b.d, 0, sign * push * (b.weight / totalW));
          }
        }
      }
      if (!moved) break;
    }
  }

  function update(source) {
    root.each((d) => {
      const key = d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : '');
      const angleJitter = d.depth === 0 ? 0 : (hash01(key) - 0.5) * ANGLE_JITTER;
      const gap = nodeGap(d); // depth 1(태양계)은 넉넉하게, depth 2 이상(위성/게시물)은 좁게
      const radiusJitter = d.depth === 0 ? 0 : (hash01(key + '#r') - 0.5) * gap * RADIUS_JITTER;
      const rel = relevance(d);
      const baseLocalRadius = gap * (1 - rel * RELEVANCE_SHRINK); // 자기 부모로부터의 거리(더는 루트 기준 누적이 아님)
      // 실제 태양계처럼 궤도 거리가 확실히 들쭉날쭉하도록, 노드마다 0.55~2.3배 사이의
      // 고정된(의사난수) 배율을 곱한다 — 그냥 미세한 흔들림(radiusJitter)만으로는 너무 밋밋하다.
      const orbitTier = 0.55 + hash01(key + '#tier') * 1.75;
      const localAngle = siblingAngle(d) + angleJitter; // 형제끼리 부모 둘레에 고르게 분배 + 미세한 각도 흔들림
      // depth 1(태양 바로 다음)은 큰 로고 이미지와 겹치지 않도록 최소 거리를 더 넉넉히 둔다.
      const minRadius = d.depth === 1 ? ROOT_CLEARANCE : gap * 0.4;
      const localRadius = d.depth === 0 ? 0 : Math.max(baseLocalRadius * orbitTier + radiusJitter, minRadius);

      // 펼쳐서 하위 노드를 보여주는 중인 노드는 자기 부모(=태양계)에서 멀리 끌려나와,
      // 그 하위 노드들이 자신을 중심으로 도는 별도의 작은 태양계처럼 보이게 한다. 그냥
      // 부모 기준 각도 방향으로 밀면 방향에 따라 기존 태양계 쪽으로 다시 겹쳐 들어올 수
      // 있으므로, 태양(루트)에서 더 멀어지는 방향으로 밀어낸다.
      if (d.parent && d.children) {
        const parentAx = d.parent.__ax || 0;
        const parentAy = d.parent.__ay || 0;
        const estAx = parentAx + localRadius * Math.sin(localAngle);
        const estAy = parentAy - localRadius * Math.cos(localAngle);
        const distFromRoot = Math.sqrt(estAx * estAx + estAy * estAy) || 1;
        const dirX = estAx / distFromRoot;
        const dirY = estAy / distFromRoot;
        const boostedAx = estAx + dirX * FOCUS_DISTANCE_BOOST;
        const boostedAy = estAy + dirY * FOCUS_DISTANCE_BOOST;
        const localBoostedX = boostedAx - parentAx;
        const localBoostedY = boostedAy - parentAy;
        d.y = Math.sqrt(localBoostedX * localBoostedX + localBoostedY * localBoostedY);
        d.x = Math.atan2(localBoostedX, -localBoostedY);
      } else {
        d.x = localAngle;
        d.y = localRadius;
      }
      // 반지름만으로는 공전 속도가 비슷한 노드끼리 묶여 보일 수 있어, 노드마다 고정된
      // 배율(0.6~1.8배)을 추가로 곱해 서로 확실히 다른 속도로 돌게 한다.
      d.__speedMul = 0.6 + hash01(key + '#speed') * 1.2;
    });
    computeAbsolutePositions();

    const nodes = root.descendants();
    resolveLabelOverlaps(nodes);
    // 겹침 해소 과정에서 depth 1 노드가 최소 거리(ROOT_CLEARANCE)보다 안쪽으로 밀려
    // 들어와 태양 로고와 겹치지 않도록 다시 한번 확인한다.
    root.each((d) => {
      if (d.depth === 1 && d.y < ROOT_CLEARANCE) d.y = ROOT_CLEARANCE;
    });
    computeAbsolutePositions(); // 겹침 해소로 바뀐 로컬 값을 절대 좌표에 다시 반영(자식들까지 연쇄 반영)
    previousKeys = new Set(nodes.map(keyOf));

    // 새로 나타나거나 사라지는 가지·글자는 클릭한 노드(source)의 현재 위치에서
    // 자라나거나 그 자리로 접혀 들어가는 것처럼 애니메이션한다.
    const origin = { __ax: source.__ax, __ay: source.__ay };

    // 태양계 궤도: 각 노드는 "자기 부모"를 중심으로 자기 반지름(y)만큼 떨어진 원형 궤도를 돈다.
    // 가지·노드보다 먼저 그려서 항상 맨 뒤에 깔리게 한다.
    const orbitNodes = nodes.filter((d) => d.depth > 0);
    const orbit = g.selectAll('circle.orbit-ring')
      .data(orbitNodes, (d) => d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : ''));

    orbit.enter().insert('circle', ':first-child')
      .attr('class', 'orbit-ring')
      .attr('cx', origin.__ax)
      .attr('cy', origin.__ay)
      .attr('r', 0)
      .merge(orbit)
      .transition().duration(TRANSITION_MS)
      .attr('cx', (d) => absX(d.parent))
      .attr('cy', (d) => absY(d.parent))
      .attr('r', (d) => d.y);

    orbit.exit()
      .transition().duration(TRANSITION_MS)
      .attr('r', 0)
      .remove();

    // 노드(텍스트만)
    const node = g.selectAll('g.node')
      .data(nodes, (d) => d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : ''));

    // 클릭과 키보드(Enter/Space) 둘 다에서 같은 동작을 하도록 함수로 뺀다.
    function activateNode(d) {
      markUpdateSeen(d.data.name);
      if (d.data.url) {
        window.open(withGalleryTitle(d.data.url, d.data.name), '_blank', 'noopener');
        return;
      }
      const willExpand = !d.children && !!d._children;
      if (d.children) {
        d._children = d.children;
        d.children = null;
        // 노드를 다시 눌러서 직접 접으면, 그 이후의 "앞으로 가기" 기록은 더 이상
        // 의미가 없으므로 이 노드부터 잘라낸다(브라우저에서 새 링크를 누르면 기존
        // "앞으로 가기" 기록이 사라지는 것과 같다).
        const idx = expandHistory.indexOf(d);
        if (idx !== -1) {
          expandHistory.length = idx;
          historyPos = Math.min(historyPos, idx);
        }
      } else if (d._children) {
        d.children = d._children;
        d._children = null;
        expandHistory.length = historyPos; // 뒤로가기 한 뒤 새로 펼치면 그 뒤 기록은 버린다
        expandHistory.push(d);
        historyPos = expandHistory.length;
      }
      // 펼치는 중인 노드는 그 자리에 완전히 멈춰 세운다(나머지는 계속 공전). 다시 눌러서
      // 원래 자리로 접으면 멈춤을 풀어서 다시 공전을 시작한다.
      if (willExpand) pausedNodes.add(d);
      else pausedNodes.delete(d);
      update(d);
      centerOnNode(d, { zoomIn: willExpand });
      updateHistoryButtons();
    }

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', nodeTransform(origin))
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) => (d.data.url ? `${d.data.name} (새 창에서 열기)` : `${d.data.name} (펼치기/접기)`))
      .style('cursor', 'pointer')
      .on('click', (_event, d) => activateNode(d))
      .on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          activateNode(d);
        }
      });

    // 가지 끝(루트 제외)을 "행성"처럼 그린다. 하위 콘텐츠가 많을수록 크게, 실제 태양계
    // 행성 색에 가깝게, 그리고 밝게 빛난다.
    nodeEnter.filter((d) => d.depth > 0).append('circle')
      .attr('class', 'glow-tip')
      .attr('r', 0)
      .style('fill', (d) => planetColorOf(d))
      .style('filter', 'url(#branchGlow)')
      .style('opacity', 0);

    // 루트(마인드맵 정중앙)에는 "SAM ARCHIVE" 글자 대신 로고 이미지만 그 지점에 그린다.
    const ROOT_LOGO_SIZE = 140;
    nodeEnter.filter((d) => d.depth === 0).append('image')
      .attr('class', 'root-logo')
      .attr('href', currentLogoHref())
      .attr('x', -ROOT_LOGO_SIZE / 2)
      .attr('y', -ROOT_LOGO_SIZE / 2)
      .attr('width', ROOT_LOGO_SIZE)
      .attr('height', ROOT_LOGO_SIZE);

    nodeEnter.filter((d) => d.depth > 0).append('text')
      .attr('class', 'node-label')
      .attr('dy', '-1.1em')
      .attr('text-anchor', 'middle')
      .style('font-size', (d) => fontSizeFor(d.depth))
      .style('opacity', 0)
      .text((d) => d.data.name);

    const nodeMerge = nodeEnter.merge(node);
    nodeMerge.attr('aria-expanded', (d) => (d.data.url ? null : String(Boolean(d.children))));
    nodeMerge.transition().duration(TRANSITION_MS)
      .attr('transform', nodeTransform);
    nodeMerge.select('circle.glow-tip')
      .style('fill', (d) => planetColorOf(d))
      .transition().duration(TRANSITION_MS)
      .attr('r', (d) => planetRadius(d.__fullSize))
      .style('opacity', 1);
    nodeMerge.select('text')
      .style('font-size', (d) => fontSizeFor(d.depth))
      .text((d) => d.data.name)
      .transition().duration(TRANSITION_MS)
      .style('opacity', 1);

    // 최근 업데이트된 카테고리 글자 오른쪽 위에 빨간 점 표시
    nodeMerge.each(function (d) {
      const nodeGroup = d3.select(this);
      let badge = nodeGroup.select('circle.new-badge');
      const textEl = this.querySelector('text');
      if (textEl && isRecentlyUpdated(d.data.name)) {
        const textBBox = textEl.getBBox();
        const bx = textBBox.x + textBBox.width + 2;
        const by = textBBox.y;
        if (badge.empty()) {
          badge = nodeGroup.append('circle')
            .attr('class', 'new-badge')
            .attr('r', 4)
            .style('fill', '#e0483e')
            .style('stroke', 'var(--bg)')
            .style('stroke-width', '1.5px');
        }
        badge.attr('cx', bx).attr('cy', by);
      } else if (!badge.empty()) {
        badge.remove();
      }
    });

    node.exit()
      .transition().duration(TRANSITION_MS)
      .attr('transform', nodeTransform(origin))
      .style('opacity', 0)
      .remove();
  }

  // ---------- 태양계처럼: 느린 공전 애니메이션 ----------
  // 각 노드는 "자기 부모"를 중심으로 자기 반지름(y)만큼 떨어져 도므로, 매 프레임 d.x(부모
  // 기준 각도)를 아주 조금씩 늘리고 위에서 아래로(부모→자식) 절대 좌표를 다시 누적 계산한다
  // (부모가 같이 움직이면 그 자식도 함께 실려간다 — 행성이 돌면 위성도 같이 따라 도는 것과 같다).
  // 안쪽 궤도(반지름이 작을수록)일수록 더 빠르게 돈다. 클릭해서 멈춘 노드(pausedNodes)는
  // 계속 멈춰 있고 나머지는 계속 돈다.
  let lastOrbitElapsed = 0;
  d3.timer((elapsed) => {
    if (treeEl.style.display === 'none') {
      lastOrbitElapsed = elapsed;
      return;
    }
    const dt = (elapsed - lastOrbitElapsed) / 1000;
    lastOrbitElapsed = elapsed;
    root.each((d) => {
      if (d.depth > 0 && !pausedNodes.has(d)) d.x += dt * (ORBIT_ANGULAR_K / d.y) * (d.__speedMul || 1);
    });
    computeAbsolutePositions();
    g.selectAll('g.node').attr('transform', nodeTransform);
    g.selectAll('circle.orbit-ring')
      .attr('cx', (d) => absX(d.parent))
      .attr('cy', (d) => absY(d.parent));
  });

  // ---------- 뒤로가기 / 앞으로 가기 (펼치기 기록을 되감기/다시 감기) ----------
  const backBtn = document.getElementById('backBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  function updateHistoryButtons() {
    backBtn.disabled = historyPos === 0;
    forwardBtn.disabled = historyPos >= expandHistory.length;
  }
  function goBack() {
    if (historyPos === 0) return;
    historyPos -= 1;
    const d = expandHistory[historyPos];
    if (d.children) {
      d._children = d.children;
      d.children = null;
    }
    pausedNodes.delete(d); // 되돌아왔으니 다시 공전을 재개한다
    update(d);
    if (d.parent) centerOnNode(d.parent, { zoomIn: true });
    else fit();
    updateHistoryButtons();
  }
  function goForward() {
    if (historyPos >= expandHistory.length) return;
    const d = expandHistory[historyPos];
    historyPos += 1;
    if (d._children) {
      d.children = d._children;
      d._children = null;
    }
    pausedNodes.add(d);
    update(d);
    centerOnNode(d, { zoomIn: true });
    updateHistoryButtons();
  }
  backBtn.addEventListener('click', goBack);
  forwardBtn.addEventListener('click', goForward);

  // ---------- 확대 / 축소 버튼 (누르고 있으면 계속 확대·축소된다) ----------
  function wireHoldToRepeat(el, factor) {
    let timeoutId = null;
    let intervalId = null;
    const step = (instant) => {
      if (instant) svg.call(zoomBehavior.scaleBy, factor);
      else svg.transition().duration(200).call(zoomBehavior.scaleBy, factor);
    };
    const start = (event) => {
      event.preventDefault();
      step(false);
      timeoutId = setTimeout(() => {
        intervalId = setInterval(() => step(true), 80);
      }, 350);
    };
    const stop = () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      timeoutId = null;
      intervalId = null;
    };
    el.addEventListener('mousedown', start);
    el.addEventListener('touchstart', start, { passive: false });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((evt) => el.addEventListener(evt, stop));
  }
  wireHoldToRepeat(document.getElementById('zoomInBtn'), 1.4);
  wireHoldToRepeat(document.getElementById('zoomOutBtn'), 1 / 1.4);

  // OS/브라우저 테마가 실시간으로 바뀌면 중심 로고도 즉시 맞춰 바꾼다.
  lightSchemeQuery.addEventListener('change', () => {
    g.select('image.root-logo').attr('href', currentLogoHref());
  });

  update(root);
  updateHistoryButtons();
  requestAnimationFrame(fit);
  window.addEventListener('resize', fit);
  document.getElementById('fitBtn').addEventListener('click', fit);

  // 좌측 상단 로고 클릭 시 처음 상태(중심 글자만)로 되돌아가 마인드맵을 화면 중앙에 맞춘다.
  const homeLink = document.getElementById('homeLink');
  if (homeLink) {
    homeLink.addEventListener('click', () => {
      collapseBeyond(root, 0);
      expandHistory = [];
      historyPos = 0;
      updateHistoryButtons();
      update(root);
      showingList = false;
      applyViewState();
      fit();
    });
  }

  // ---------- 5. 마인드맵(기본값) / 리스트 보기 토글 ----------
  // 마인드맵(SVG)은 순전히 그림이라 키보드·스크린 리더로는 사실상 조작이 안 되므로,
  // 실제 <a href> 링크와 <h2>~<h5> 제목 구조를 가진 리스트 뷰도 함께 만들어 두고
  // "리스트로 보기" 버튼으로 언제든 전환할 수 있게 한다.
  const HEADING_TAGS = ['h2', 'h3', 'h4', 'h5', 'h6'];
  function headingTagFor(depth) {
    return HEADING_TAGS[Math.min(depth, HEADING_TAGS.length - 1)];
  }
  function renderListHTML(node, depth) {
    if (!node.children || node.children.length === 0) {
      return node.url
        ? `<li><a href="${withGalleryTitle(node.url, node.name)}" target="_blank" rel="noopener">${node.name}</a></li>`
        : `<li>${node.name}</li>`;
    }
    const tag = headingTagFor(depth);
    const items = node.children.map((c) => renderListHTML(c, depth + 1)).join('');
    return `<details open><summary><${tag}>${node.name}</${tag}></summary><ul>${items}</ul></details>`;
  }

  const listView = document.getElementById('listView');
  listView.innerHTML = `<ul>${(data.children || []).map((c) => renderListHTML(c, 0)).join('')}</ul>`;

  const treeEl = document.getElementById('tree');
  const listToggle = document.getElementById('listToggle');
  // 링크로 들어오면 항상 마인드맵을 바로 보여준다.
  let showingList = false;
  function applyViewState() {
    // SVG 요소는 hidden 프로퍼티가 속성으로 반영되지 않아 style.display로 직접 제어
    treeEl.style.display = showingList ? 'none' : '';
    listView.hidden = !showingList;
    listToggle.textContent = showingList ? '마인드맵으로 보기' : '리스트로 보기';
  }
  applyViewState();
  if (!showingList) fit();
  listToggle.addEventListener('click', () => {
    showingList = !showingList;
    applyViewState();
    // 마인드맵으로 바꿀 때: 숨겨져 있는 동안(display:none)엔 크기를 잴 수 없어
    // "화면에 맞추기" 계산이 어긋나므로, 보이게 된 시점에 다시 맞춰준다.
    if (!showingList) fit();
  });
})();