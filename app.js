// ============================================================
// 문학회 매거진 아카이브 — SAM ARCHIVE를 중심으로 사방(360도)에 뻗어나가는 마인드맵
// markmap 대신 d3.hierarchy + d3.tree(방사형)를 직접 사용합니다.
// 앞으로 이 파일은 다시 건드릴 필요가 없습니다. (수정 대상은 archive.md만)
// ============================================================

(async () => {
  // ---------- 0. 설정값 ----------
  const RADIUS = 11;                 // 원 크기 (더 크게)
  const NODE_DY = 110;                // 부모-자식 간 반지름 간격 (깊이 방향, 전체적으로 짧게)
  const COLOR_TOP = '#3f7d4f';        // 맨 위(뿌리/호수) — 초록 계열
  const COLOR_BOTTOM = '#7a4a25';     // 맨 아래(게시물 리프) — 갈색 계열
  const MAX_DEPTH = 3;                // 호수(1) → 유형(2) → 게시물(3)
  const INITIAL_VISIBLE_DEPTH = 0;    // 처음엔 중심 글자(루트)만 보여주고, 클릭하면 가지가 뻗어나옴

  const colorScale = d3.interpolateRgb(COLOR_TOP, COLOR_BOTTOM);
  const colorOf = (d) => colorScale(Math.min(d.depth / MAX_DEPTH, 1));

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
  function isRecentlyUpdated(name) {
    const at = lastUpdatedAt.get(name);
    return typeof at === 'number' && Date.now() - at < NEW_BADGE_MS;
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

  // ---------- 2. d3 계층 + 트리 레이아웃 (SAM ARCHIVE를 중심으로 사방 360도 펼침) ----------
  const root = d3.hierarchy(data);
  // 각도(x)만 0~2π로 배분받고, 반지름(y)은 아래에서 depth 기준으로 직접 계산한다.
  const treeLayout = d3.tree()
    .size([2 * Math.PI, 1])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

  // 접기 전에 "원래 하위 트리 크기"를 노드마다 미리 저장해둔다 (자기 자신 포함).
  // 나중에 접혔다 펼쳐졌다 해도 이 값은 안 바뀌어야 하므로 collapseBeyond보다 먼저 계산.
  root.each((d) => { d.__fullSize = d.descendants().length; });

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

  const zoomBehavior = d3.zoom()
    .scaleExtent([0.3, 3])
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
  // 극좌표(d.x=각도, d.y=반지름) → 화면 좌표 변환. 각도가 0~2π 전체를 돌며
  // SAM ARCHIVE를 중심으로 사방(위·아래·좌·우 전부)에 가지가 뻗는다.
  const cartesianX = (d) => d.y * Math.sin(d.x);
  const cartesianY = (d) => -d.y * Math.cos(d.x);
  const nodeTransform = (d) => `translate(${cartesianX(d)},${cartesianY(d)})`;
  const radialLink = d3.linkRadial().angle((d) => d.x).radius((d) => d.y);

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
  const ANGLE_JITTER = 0.16;      // 라디안, 약 ±9도
  const RADIUS_JITTER = 0.22;     // NODE_DY 대비 비율, 약 ±22%

  // "연관도"의 대리 지표: 이 노드의 하위 트리가 부모의 하위 트리에서 차지하는
  // 비중. 부모 아래 콘텐츠의 큰 부분을 차지할수록(=구조적으로 강하게 연결될수록)
  // 연관도가 높다고 보고 가지를 짧게, 부모 대비 비중이 작은(곁가지성) 항목은
  // 가지를 길게 만든다. __fullSize는 접기 전에 미리 계산해둔 값이라 펼침 상태와
  // 무관하게 항상 같다.
  function relevance(d) {
    if (!d.parent) return 0;
    return Math.min(1, d.__fullSize / d.parent.__fullSize);
  }
  const RELEVANCE_SHRINK = 0.45; // 연관도가 1일 때 반지름을 최대 45%까지 줄임
  const TRANSITION_MS = 450;     // 가지가 펼쳐지는 애니메이션 시간

  // 글씨 크기: 루트 36px → 1단계(호수) 20px → 2단계 이하는 전부 16px로 통일
  function fontSizeFor(depth) {
    if (depth === 0) return '36px';
    if (depth === 1) return '20px';
    return '16px';
  }
  const fontPxFor = (depth) => (depth === 0 ? 36 : depth === 1 ? 20 : 16);

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

  function applyCartesian(d, cx, cy) {
    const r = Math.sqrt(cx * cx + cy * cy);
    if (r < 1e-6) return; // 중심으로 완전히 붕괴하는 것만 방지
    d.y = Math.max(r, NODE_DY * 0.3);
    d.x = Math.atan2(cx, -cy);
  }
  function shiftCartesian(d, dCx, dCy) {
    applyCartesian(d, cartesianX(d) + dCx, cartesianY(d) + dCy);
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
          const ax = cartesianX(a.d);
          const ay = cartesianY(a.d) - a.labelDy;
          const bx = cartesianX(b.d);
          const by = cartesianY(b.d) - b.labelDy;
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
    treeLayout(root);
    root.each((d) => {
      const key = d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : '');
      const angleJitter = d.depth === 0 ? 0 : (hash01(key) - 0.5) * ANGLE_JITTER;
      const radiusJitter = d.depth === 0 ? 0 : (hash01(key + '#r') - 0.5) * NODE_DY * RADIUS_JITTER;
      const rel = relevance(d);
      const baseRadius = d.depth * NODE_DY * (1 - rel * RELEVANCE_SHRINK);
      d.x = d.x + angleJitter; // 0~2π 그대로 사방으로 고르게 분배 + 미세한 각도 흔들림
      d.y = d.depth === 0 ? 0 : Math.max(baseRadius + radiusJitter, NODE_DY * 0.4); // 연관도가 높을수록 가지가 짧아짐
    });

    const nodes = root.descendants();
    resolveLabelOverlaps(nodes);
    previousKeys = new Set(nodes.map(keyOf));

    const links = root.links();
    // 새로 나타나거나 사라지는 가지·글자는 클릭한 노드(source)의 현재 위치에서
    // 자라나거나 그 자리로 접혀 들어가는 것처럼 애니메이션한다.
    const origin = { x: source.x, y: source.y };

    // 가지(선)
    const link = g.selectAll('path.link')
      .data(links, (d) => d.target.data.name + '-' + d.target.depth + '-' + (d.target.parent ? d.target.parent.data.name : ''));

    const linkEnter = link.enter().append('path')
      .attr('class', 'link')
      .attr('stroke', (d) => colorOf(d.target))
      .attr('d', radialLink({ source: origin, target: origin }));

    linkEnter.merge(link)
      .transition().duration(TRANSITION_MS)
      .attr('stroke', (d) => colorOf(d.target))
      .attr('d', radialLink);

    link.exit()
      .transition().duration(TRANSITION_MS)
      .attr('d', radialLink({ source: origin, target: origin }))
      .remove();

    // 노드(텍스트만)
    const node = g.selectAll('g.node')
      .data(nodes, (d) => d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : ''));

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', nodeTransform(origin))
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        if (d.data.url) {
          window.open(d.data.url, '_blank', 'noopener');
          return;
        }
        if (d.children) {
          d._children = d.children;
          d.children = null;
        } else if (d._children) {
          d.children = d._children;
          d._children = null;
        }
        update(d);
        fit();
      });

    nodeEnter.append('text')
      .attr('class', 'node-label')
      .attr('dy', '-1.1em')
      .attr('text-anchor', 'middle')
      .style('font-size', (d) => fontSizeFor(d.depth))
      .style('opacity', 0)
      .text((d) => d.data.name);

    const nodeMerge = nodeEnter.merge(node);
    nodeMerge.transition().duration(TRANSITION_MS)
      .attr('transform', nodeTransform);
    nodeMerge.select('text')
      .style('font-size', (d) => fontSizeFor(d.depth))
      .text((d) => d.data.name)
      .transition().duration(TRANSITION_MS)
      .style('opacity', 1);

    // 최근 업데이트된 카테고리 글자 오른쪽 위에 빨간 점 표시
    nodeMerge.each(function (d) {
      const nodeGroup = d3.select(this);
      let badge = nodeGroup.select('circle.new-badge');
      if (isRecentlyUpdated(d.data.name)) {
        const textBBox = this.querySelector('text').getBBox();
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

  update(root);
  requestAnimationFrame(fit);
  window.addEventListener('resize', fit);
  document.getElementById('fitBtn').addEventListener('click', fit);

  // ---------- 5. 리스트 보기 토글 (모바일 등 트리 조작이 불편할 때 대안) ----------
  function renderListHTML(node) {
    if (!node.children || node.children.length === 0) {
      return node.url
        ? `<li><a href="${node.url}" target="_blank" rel="noopener">${node.name}</a></li>`
        : `<li>${node.name}</li>`;
    }
    const items = node.children.map(renderListHTML).join('');
    return `<details open><summary>${node.name}</summary><ul>${items}</ul></details>`;
  }

  const listView = document.getElementById('listView');
  listView.innerHTML = `<ul>${(data.children || []).map(renderListHTML).join('')}</ul>`;

  const treeEl = document.getElementById('tree');
  const listToggle = document.getElementById('listToggle');
  let showingList = false;
  listToggle.addEventListener('click', () => {
    showingList = !showingList;
    // SVG 요소는 hidden 프로퍼티가 속성으로 반영되지 않아 style.display로 직접 제어
    treeEl.style.display = showingList ? 'none' : '';
    listView.hidden = !showingList;
    listToggle.textContent = showingList ? '마인드맵으로 보기' : '리스트로 보기';
  });
})();