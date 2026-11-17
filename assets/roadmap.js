/* Shared date geometry for the screen, image, and standalone share document. */
globalThis.Roadmap = (() => {
  const DAY = 86400000;
  const colors = { green: ['개발', '#147a45'], blue: ['제작', '#315cab'], orange: ['테스트', '#b85c17'], red: ['주요 일정', '#c62239'], gray: ['기타', '#515b57'] };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function lines(value, maxWidth, size) {
    const result = ['']; let used = 0;
    for (const char of String(value || '')) {
      const width = size * (char.charCodeAt(0) > 255 ? 1 : 0.6);
      if (char === '\n' || used + width > maxWidth) { result.push(''); used = 0; }
      if (char !== '\n') { result[result.length - 1] += char; used += width; }
    }
    return result;
  }
  function date(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const n = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n : null;
  }
  function selectedProjects(projects, ids) {
    return Array.isArray(ids) ? projects.filter(p => ids.includes(p.id)) : projects;
  }
  function portfolio(projects) {
    return {
      name: projects.length === 1 ? projects[0].name : '프로젝트 로드맵',
      description: projects.map(p => p.name).join(' · '),
      milestones: projects.flatMap(p => p.milestones.map(m => ({
        ...m, id: JSON.stringify([p.id, m.id]), projectId: p.id,
        group: p.name + (m.group ? '\n' + m.group : ''),
        groupKey: JSON.stringify([p.id, m.group || '']),
      }))),
    };
  }
  function layout(items, today) {
    const pending = [], groups = new Map(), dated = [];
    items.forEach(item => {
      const end = date(item.due), start = date(item.start) ?? end;
      if (end === null || start > end) { pending.push(item); return; }
      dated.push({ ...item, startTime: start, endTime: end });
    });
    const dates = dated.flatMap(m => [m.startTime, m.endTime]);
    const first = new Date(dates.length ? Math.min(...dates) : date(today));
    const last = new Date(dates.length ? Math.max(...dates) : date(today));
    const start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    const end = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1);
    const months = [];
    for (let t = start; t < end;) {
      const d = new Date(t), next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      // Match the calendar view: Sunday through Saturday, clipped to this month.
      const weeks = [];
      for (let ws = t; ws < next;) {
        const we = Math.min(next, ws + (7 - new Date(ws).getUTCDay()) * DAY);
        weeks.push({ start: ws, end: we, number: weeks.length + 1 });
        ws = we;
      }
      months.push({ start: t, end: next, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, weeks });
      t = next;
    }
    dated.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime).forEach(m => {
      const name = m.group || '전체 일정';
      const key = m.groupKey || name;
      if (!groups.has(key)) groups.set(key, { name, lanes: [], items: [] });
      const group = groups.get(key);
      let lane = group.lanes.findIndex(end => end < m.startTime);
      if (lane < 0) lane = group.lanes.length;
      group.lanes[lane] = m.endTime;
      group.items.push({ ...m, lane });
    });
    return { start, end, months, groups: [...groups.values()], pending, dated };
  }
  function svg(project, today, { interactive = false, report = false } = {}) {
    const model = layout(project.milestones, today);
    const left = 164, right = 28, width = Math.max(1120, Math.min(7200, model.months.length * 240 + left + right));
    const titleLines = lines(project.name, width - 56, 28), descriptionLines = lines(project.description, width - 56, 14);
    const plot = width - left - right, header = report ? 152 + (titleLines.length - 1) * 34 + (descriptionLines.length - 1) * 20 : 28, top = header + 106;
    let bottom = top;
    model.groups.forEach(g => { g.y = bottom; g.labelLines = lines(g.name, left - 48, 13); g.height = Math.max(76, g.lanes.length * 52 + 24, g.labelLines.length * 18 + 30); bottom += g.height + 8; });
    if (!model.groups.length) bottom += 110;
    const x = time => left + (time - model.start) / (model.end - model.start) * plot;
    const barLabel = m => (m.status === 'done' ? '✓ ' : m.status === 'doing' ? '● ' : '') + m.title;
    const short = model.dated.filter(m => { const w = x(m.endTime + DAY) - x(m.startTime) - 16; return w < 30 || lines(barLabel(m), w, 11).length > 2; });
    const notes = [...short.map((m, i) => ({ ...m, note: `${i + 1}. ${m.title} · ${m.start || m.due} ~ ${m.due}` })), ...model.pending.map(m => ({ ...m, note: `날짜 미정 · ${m.group || '전체 일정'} / ${m.title}` }))];
    const pendingTop = bottom + 22;
    let noteHeight = 0;
    notes.forEach(m => { m.lines = lines(m.note, width - 56, 13); m.offset = noteHeight; noteHeight += m.lines.length * 20 + 12; });
    const height = pendingTop + noteHeight + 62;
    const rect = (x, y, w, h, fill, radius = 8, extra = '') => `<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${h}" rx="${radius}" fill="${fill}" ${extra}/>`;
    const text = (x, y, value, size = 13, fill = '#fff', extra = '') => `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" ${extra}>${escape(value)}</text>`;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="${interactive ? 'group' : 'img'}" aria-label="${escape(project.name)} 월별 마일스톤 로드맵" style="font-family:'Pretendard Variable','Malgun Gothic',sans-serif"><title>${escape(project.name)} — 마일스톤 로드맵</title>`;
    out += rect(0, 0, width, height, '#f5f4ee', 14);
    if (report) {
      out += text(28, 38, 'PROJECT ROADMAP', 12, '#537264', 'letter-spacing="2"');
      titleLines.forEach((line, i) => { out += text(28, 77 + i * 34, line, 28, '#11563f', 'font-weight="700"'); });
      descriptionLines.forEach((line, i) => { out += text(28, 105 + (titleLines.length - 1) * 34 + i * 20, line, 14, '#537264'); });
      out += text(28, header - 21, `공유 시점 ${today} · 완료 ${project.milestones.filter(m => m.status === 'done').length} / ${project.milestones.length}`, 12, '#537264');
    }
    out += text(28, header + 33, '업무 구분', 13, '#537264', 'font-weight="700"');
    model.months.forEach(month => {
      const mx = x(month.start), mw = x(month.end) - mx;
      out += rect(mx + 2, header, mw - 4, 44, '#303d37');
      out += text(mx + mw / 2, header + 28, `${month.year}.${String(month.month).padStart(2, '0')}`, 17, '#fff', 'text-anchor="middle" font-weight="700"');
      for (const week of month.weeks) {
        const ws = week.start, we = week.end;
        const active = date(today) >= ws && date(today) < we;
        const label = `W${week.number} · ${new Date(ws).toISOString().slice(0, 10)} ~ ${new Date(we - DAY).toISOString().slice(0, 10)}`;
        out += `<g><title>${label}</title>`;
        out += rect(x(ws) + 2, header + 48, x(we) - x(ws) - 4, 40, active ? '#c62239' : '#e0e4dc', 6);
        const fontSize = Math.min(12, Math.max(6, (x(we) - x(ws) - 2) / 1.6));
        out += text((x(ws) + x(we)) / 2, header + 74, `W${week.number}`, fontSize, active ? '#fff' : '#3f5549', 'text-anchor="middle" font-weight="700"') + '</g>';
      }
    });
    model.groups.forEach((group, gi) => {
      out += rect(16, group.y + 12, left - 28, group.height - 24, '#303d37');
      out += `<clipPath id="group-${gi}"><rect x="23" y="${group.y}" width="${left - 42}" height="${group.height}"/></clipPath>`;
      group.labelLines.forEach((line, i) => { out += text((left + 4) / 2, group.y + group.height / 2 + 5 + (i - (group.labelLines.length - 1) / 2) * 18, line, 13, '#fff', `text-anchor="middle" font-weight="700" clip-path="url(#group-${gi})"`); });
      out += rect(left, group.y, plot, group.height, '#e6e8e1', 12);
      model.months.slice(1).forEach(m => { out += `<path d="M${x(m.start)} ${group.y}v${group.height}" stroke="#cbd2c7" stroke-dasharray="3 5"/>`; });
      group.items.forEach((m, mi) => {
        const bx = x(m.startTime) + 2, bw = Math.max(6, x(m.endTime + DAY) - x(m.startTime) - 4), by = group.y + 14 + m.lane * 52;
        const label = `${m.title} · ${m.start || m.due} ~ ${m.due} · ${{todo:'예정',doing:'진행 중',done:'완료'}[m.status] || '예정'}${interactive && m.details ? ' · ' + m.details : ''}`;
        out += `<g ${interactive ? `data-m="${escape(m.id)}" tabindex="0" role="button" aria-label="${escape(label)}" style="cursor:pointer"` : ''}><title>${escape(label)}</title>`;
        out += rect(bx, by, bw, 38, (Object.hasOwn(colors, m.color) ? colors[m.color] : colors.blue)[1], 7);
        out += `<clipPath id="bar-${gi}-${mi}"><rect x="${bx + 4}" y="${by}" width="${Math.max(0,bw - 8)}" height="38"/></clipPath>`;
        const number = short.findIndex(s => s.id === m.id);
        if (number >= 0) out += text(bx + bw / 2, by - 3, number + 1, 10, '#303d37', 'text-anchor="middle" font-weight="700"');
        else {
          const labelLines = lines(barLabel(m), bw - 12, 11);
          labelLines.forEach((line, i) => { out += text(bx + bw / 2, by + 23 + (i - (labelLines.length - 1) / 2) * 14, line, 11, '#fff', `text-anchor="middle" font-weight="700" clip-path="url(#bar-${gi}-${mi})"`); });
        }
        out += '</g>';
      });
    });
    if (!model.groups.length) out += text(left + plot / 2, top + 58, '시작일과 종료일을 지정해 첫 일정을 그려 보세요.', 16, '#537264', 'text-anchor="middle"');
    // A compact key preserves titles for single-day and short bars in shared images too.
    if (notes.length) {
      notes.forEach((m, i) => {
        out += `<g ${interactive ? `data-m="${escape(m.id)}" tabindex="0" role="button" aria-label="${escape(m.note)}" style="cursor:pointer"` : ''}>`;
        m.lines.forEach((line, j) => { out += text(28, pendingTop + 20 + m.offset + j * 20, line, 13, '#303d37'); });
        out += '</g>';
      });
    }
    out += text(28, height - 23, '일요일–토요일 기준 · W1은 매월 1일이 포함된 주 · 월 경계에서 나누어 표시', 11, '#537264');
    out += text(width - 28, height - 23, '● 진행 중   ✓ 완료   빨간 주차 = 오늘', 11, '#537264', 'text-anchor="end"');
    return { markup: out + '</svg>', width, height, model };
  }
  return { colors, escape, date, layout, svg, selectedProjects, portfolio };
})();
