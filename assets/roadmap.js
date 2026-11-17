/* Shared date geometry for the screen, image, and standalone share document. */
globalThis.Roadmap = (() => {
  const DAY = 86400000;
  const colors = { green: ['개발', '#dcebd8'], blue: ['제작', '#d5e5fc'], orange: ['테스트', '#ffe4b8'], red: ['주요 일정', '#f2d5cc'], gray: ['기타', '#e5e8de'] };
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
        ...m, id: JSON.stringify([p.id, m.id]), projectId: p.id, projectName: p.name,
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
    const left = 196, right = 28, width = Math.max(1120, Math.min(7200, model.months.length * 240 + left + right));
    const titleLines = lines(report ? project.name : '프로젝트 기간 로드맵', width - 56, 24), descriptionLines = lines(report ? project.description : '프로젝트별 작업 기간을 월·주차 단위로 함께 살펴보세요.', width - 56, 12);
    const plot = width - left - right, header = 122 + titleLines.length * 30 + descriptionLines.length * 18, top = header + 90;
    let bottom = top;
    model.groups.forEach(g => { g.y = bottom; g.labelLines = lines(g.name, left - 48, 13); g.height = Math.max(92, g.lanes.length * 58 + 32, g.labelLines.length * 18 + 64); bottom += g.height + 10; });
    if (!model.groups.length) bottom += 110;
    const x = time => left + (time - model.start) / (model.end - model.start) * plot;
    const barLabel = m => (m.status === 'done' ? '완료 · ' : m.status === 'doing' ? '진행중 · ' : '') + m.title;
    const short = model.dated.filter(m => { const w = x(m.endTime + DAY) - x(m.startTime) - 16; return w < 30 || lines(barLabel(m), w, 11).length > 2; });
    const notes = [...short.map((m, i) => ({ ...m, note: `${i + 1}. ${m.title} · ${m.start || m.due} ~ ${m.due}` })), ...model.pending.map(m => ({ ...m, note: `날짜 미정 · ${m.group || '전체 일정'} / ${m.title}` }))];
    const pendingTop = bottom + 22;
    let noteHeight = 0;
    notes.forEach(m => { m.lines = lines(m.note, width - 56, 13); m.offset = noteHeight; noteHeight += m.lines.length * 20 + 12; });
    const height = pendingTop + noteHeight + 62;
    const rect = (x, y, w, h, fill, radius = 8, extra = '') => `<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${h}" rx="${radius}" fill="${fill}" ${extra}/>`;
    const text = (x, y, value, size = 13, fill = '#253b30', extra = '') => `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" ${extra}>${escape(value)}</text>`;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="${interactive ? 'group' : 'img'}" aria-label="${escape(project.name)} 월별 마일스톤 로드맵" style="font-family:'Pretendard Variable','Malgun Gothic',sans-serif"><title>${escape(project.name)} — 마일스톤 로드맵</title>`;
    out += rect(0, 0, width, height, '#faf8e9', 0);
    out += text(28, 30, 'PROJECT TIMELINE', 11, '#537264', 'letter-spacing="2"');
    titleLines.forEach((line, i) => { out += text(28, 60 + i * 30, line, 24, '#11563f', 'font-weight="700"'); });
    descriptionLines.forEach((line, i) => { out += text(28, 64 + titleLines.length * 30 + i * 18, line, 12, '#537264'); });
    let legendX=28;
    for(const [label,fill]of Object.values(colors)){
      out+=rect(legendX,header-42,12,12,fill,4,'stroke="#9ca995"')+text(legendX+19,header-31,label,11,'#537264');
      legendX+=label.length*12+44;
    }
    if(report)out+=text(width-28,header-31,`공유 시점 ${today}`,11,'#537264','text-anchor="end"');
    out += text(28, header + 24, '프로젝트 / 업무', 11, '#537264', 'font-weight="600"');
    model.months.forEach(month => {
      const mx = x(month.start), mw = x(month.end) - mx;
      out += rect(mx + 2, header, mw - 4, 34, '#43594c', 5);
      out += text(mx + mw / 2, header + 23, `${month.year}.${String(month.month).padStart(2, '0')}`, 14, '#fff', 'text-anchor="middle" font-weight="700"');
      for (const week of month.weeks) {
        const ws = week.start, we = week.end;
        const active = date(today) >= ws && date(today) < we;
        const label = `W${week.number} · ${new Date(ws).toISOString().slice(0, 10)} ~ ${new Date(we - DAY).toISOString().slice(0, 10)}`;
        out += `<g><title>${label}</title>`;
        out += rect(x(ws) + 2, header + 39, x(we) - x(ws) - 4, 30, active ? '#f5edcb' : '#fffdf2', 4, `stroke="${active ? '#9b9f76' : '#c5c4af'}"`);
        const weekWidth=x(we)-x(ws),weekLabel=weekWidth<24?String(week.number):`W${week.number}`;
        const fontSize = weekWidth<24?Math.min(10,Math.max(7,weekWidth-3)):12;
        out += text((x(ws) + x(we)) / 2, header + 59, weekLabel, fontSize, '#43594c', 'text-anchor="middle" font-weight="700"') + '</g>';
      }
    });
    model.groups.forEach((group, gi) => {
      out += rect(14, group.y, width-28, group.height, '#fffdf2', 5, 'stroke="#c5c4af" stroke-dasharray="4 5"');
      const labelHeight=group.labelLines.length*18+18;
      out += rect(24, group.y+16, left-40, labelHeight, '#43594c', 5);
      out += `<clipPath id="group-${gi}"><rect x="30" y="${group.y+16}" width="${left-52}" height="${labelHeight}"/></clipPath>`;
      group.labelLines.forEach((line, i) => { out += text(36,group.y+37+i*18,line,12,'#fff',`font-weight="600" clip-path="url(#group-${gi})"`); });
      out += text(30,group.y+labelHeight+35,`${group.items.length}개 일정`,10,'#537264');
      model.months.forEach(month=>month.weeks.forEach(week=>{
        const active=date(today)>=week.start&&date(today)<week.end;
        if(active)out+=rect(x(week.start),group.y+1,x(week.end)-x(week.start),group.height-2,'#f5edcb',0,'fill-opacity=".4"');
        out+=`<path d="M${x(week.start)} ${group.y+1}v${group.height-2}" stroke="#c5c4af" stroke-opacity=".6" stroke-dasharray="2 6"/>`;
      }));
      group.items.forEach((m, mi) => {
        const bx = x(m.startTime) + 2, bw = Math.max(6, x(m.endTime + DAY) - x(m.startTime) - 4), by = group.y + 22 + m.lane * 58;
        const label = `${m.title} · ${m.start || m.due} ~ ${m.due} · ${{todo:'시작 전',doing:'진행중',done:'완료'}[m.status] || '시작 전'}${interactive && m.details ? ' · ' + m.details : ''}`;
        out += `<g ${interactive ? `data-m="${escape(m.id)}" tabindex="0" role="button" aria-label="${escape(label)}" style="cursor:pointer"` : ''}><title>${escape(label)}</title>`;
        out += rect(bx, by, bw, 42, (Object.hasOwn(colors, m.color) ? colors[m.color] : colors.blue)[1], 5, 'stroke="#9ca995"');
        out += `<clipPath id="bar-${gi}-${mi}"><rect x="${bx + 4}" y="${by}" width="${Math.max(0,bw - 8)}" height="42"/></clipPath>`;
        const number = short.findIndex(s => s.id === m.id);
        if (number >= 0) out += text(bx + bw / 2, by - 5, number + 1, 10, '#537264', 'text-anchor="middle" font-weight="700"');
        else {
          const labelLines = lines(barLabel(m), bw - 12, 11);
          labelLines.forEach((line, i) => { out += text(bx + bw / 2, by + 25 + (i - (labelLines.length - 1) / 2) * 14, line, 11, '#253b30', `text-anchor="middle" font-weight="600" clip-path="url(#bar-${gi}-${mi})"`); });
        }
        out += '</g>';
      });
    });
    if (!model.groups.length) out += text(left + plot / 2, top + 58, '시작일과 종료일을 지정해 첫 일정을 그려 보세요.', 16, '#537264', 'text-anchor="middle"');
    // A compact key preserves titles for single-day and short bars in shared images too.
    if (notes.length) {
      out+=rect(14,pendingTop-4,width-28,noteHeight+10,'#fffdf2',5,'stroke="#c5c4af" stroke-dasharray="4 5"');
      notes.forEach((m, i) => {
        out += `<g ${interactive ? `data-m="${escape(m.id)}" tabindex="0" role="button" aria-label="${escape(m.note)}" style="cursor:pointer"` : ''}>`;
        m.lines.forEach((line, j) => { out += text(28, pendingTop + 20 + m.offset + j * 20, line, 12, '#334b3d'); });
        out += '</g>';
      });
    }
    out += text(28, height - 23, '일요일–토요일 기준 · W1은 매월 1일이 포함된 주 · 월 경계에서 나누어 표시', 11, '#537264');
    out += text(width - 28, height - 23, '일정 색상 = 업무 구분 · 옅은 노랑 = 이번 주', 11, '#537264', 'text-anchor="end"');
    return { markup: out + '</svg>', width, height, model };
  }
  return { colors, escape, date, layout, svg, selectedProjects, portfolio };
})();
