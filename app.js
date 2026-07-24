// ============================================================
// 문학회 매거진 아카이브 — 위→아래로 뻗는 나무형 마인드맵
// markmap 대신 d3.hierarchy + d3.tree를 직접 사용합니다.
// 앞으로 이 파일은 다시 건드릴 필요가 없습니다. (수정 대상은 archive.md만)
// ============================================================

(async () => {
  // ---------- 0. 설정값 ----------
  const RADIUS = 11;                 // 원 크기 (더 크게)
  const NODE_DX = 90;                // 형제 노드 간 가로 간격
  const NODE_DY = 170;                // 부모-자식 간 세로 간격 (깊이 방향)
  const COLOR_TOP = '#3f7d4f';        // 맨 위(뿌리/호수) — 초록 계열
  const COLOR_BOTTOM = '#7a4a25';     // 맨 아래(게시물 리프) — 갈색 계열
  const MAX_DEPTH = 3;                // 호수(1) → 유형(2) → 게시물(3)
  const INITIAL_VISIBLE_DEPTH = 1;    // 처음엔 호수 노드까지만 펼쳐서 보여줌

  const colorScale = d3.interpolateRgb(COLOR_TOP, COLOR_BOTTOM);
  const colorOf = (d) => colorScale(Math.min(d.depth / MAX_DEPTH, 1));

  // ---------- 1. archive.md → 계층 데이터 파싱 ----------
  const res = await fetch('archive.md', { cache: 'no-store' });
  const markdown = await res.text();

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

  // ---------- 2. d3 계층 + 트리 레이아웃 (위→아래) ----------
  const root = d3.hierarchy(data);
  const treeLayout = d3.tree().nodeSize([NODE_DX, NODE_DY]);

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
    const ty = 50 - scale * bounds.y; // 뿌리를 상단 근처에 고정

    svg.transition().duration(400).call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  }

  // ---------- 4. 렌더링 ----------
  const linkGenerator = (d) => {
    const sourceX = d.source.x;
    const sourceY = d.source.y;
    const targetX = d.target.x;
    const targetY = d.target.y;
    const bend = Math.max(8, Math.min(18, Math.abs(targetX - sourceX) * 0.2));
    const wave = Math.sin((sourceY + targetY) * 0.04 + d.target.depth) * 9;
    const curveY1 = sourceY + (targetY - sourceY) * 0.35 + wave;
    const curveY2 = targetY - (targetY - sourceY) * 0.35 - wave;

    return `M ${sourceX} ${sourceY} C ${sourceX + bend} ${curveY1}, ${targetX - bend} ${curveY2}, ${targetX} ${targetY}`;
  };

  function update() {
    treeLayout(root);
    const nodes = root.descendants();
    const links = root.links();

    // 가지(선)
    g.selectAll('path.link')
      .data(links, (d) => d.target.data.name + '-' + d.target.depth + '-' + (d.target.parent ? d.target.parent.data.name : ''))
      .join(
        (enter) => enter.append('path')
          .attr('class', 'link')
          .attr('stroke', (d) => colorOf(d.target))
          .attr('d', linkGenerator),
        (update) => update
          .attr('stroke', (d) => colorOf(d.target))
          .attr('d', linkGenerator),
        (exit) => exit.remove()
      );

    // 노드(텍스트만)
    const node = g.selectAll('g.node')
      .data(nodes, (d) => d.data.name + '-' + d.depth + '-' + (d.parent ? d.parent.data.name : ''));

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
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
        update();
        fit();
      });

    nodeEnter.append('text')
      .attr('class', 'node-label')
      .attr('dy', '-1.1em')
      .attr('text-anchor', 'middle')
      .text((d) => d.data.name);

    node.merge(nodeEnter)
      .attr('transform', (d) => `translate(${d.x},${d.y})`);

    node.select('text').text((d) => d.data.name);

    node.exit().remove();
  }

  update();
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