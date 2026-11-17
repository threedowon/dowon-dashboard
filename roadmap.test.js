import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import './assets/roadmap.js';
import './assets/dependency-map.js';
const { layout, svg, date } = globalThis.Roadmap;
const milestone = (id, start, due, group = '개발') => ({ id, title: id, start, due, group, status: 'todo', color: 'green' });

test('inclusive date ranges pack adjacent work and separate overlapping work', () => {
  const result = layout([
    milestone('first', '2026-06-01', '2026-06-07'),
    milestone('overlap', '2026-06-07', '2026-06-14'),
    milestone('adjacent', '2026-06-08', '2026-06-15'),
    milestone('other', '2026-06-01', '2026-06-30', '현장'),
  ], '2026-06-01');
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups[0].items.map(m => m.lane), [0, 1, 0]);
});
test('legacy due-only records, undated work, and reversed dates retain their entries', () => {
  const result = layout([milestone('legacy', '', '2026-12-31'), milestone('next', '2027-01-01', '2027-02-03'), milestone('pending', '', ''), milestone('invalid', '2026-09-01', '2026-08-01')], '2026-11-17');
  assert.equal(result.dated[0].startTime, result.dated[0].endTime);
  assert.deepEqual(result.months.map(m => [m.year, m.month]), [[2026,12],[2027,1],[2027,2]]);
  assert.equal(result.pending.length, 2);
});
test('leap years and month ends have real day widths', () => {
  assert.notEqual(date('2028-02-29'), null);
  assert.equal(date('2026-02-29'), null);
  const result = layout([milestone('leap', '', '2028-02-29')], '2028-02-01');
  assert.equal((result.end - result.start) / 86400000, 29);
});
test('calendar weeks follow Sunday boundaries, including partial and sixth weeks', () => {
  const june = layout([], '2026-06-01').months[0];
  const ranges = month => month.weeks.map(w => [new Date(w.start).getUTCDate(), new Date(w.end - 86400000).getUTCDate()]);
  assert.deepEqual(ranges(june), [[1,6],[7,13],[14,20],[21,27],[28,30]]);
  assert.deepEqual(ranges(layout([], '2026-08-01').months[0]), [[1,1],[2,8],[9,15],[16,22],[23,29],[30,31]]);
  assert.deepEqual(ranges(layout([], '2026-02-01').months[0]), [[1,7],[8,14],[15,21],[22,28]]);
  const leap = layout([], '2028-02-01').months[0];
  assert.equal(leap.weeks.at(-1).end, date('2028-03-01'));
});
test('sharing escapes content and preserves narrow-bar labels without edit controls', () => {
  const result = svg({ name: '<script>alert(1)</script>', description: '설명', milestones: [milestone('하루짜리 긴 제목', '', '2026-06-01')] }, '2026-06-01', { report:true });
  assert.ok(!result.markup.includes('<script>'));
  assert.ok(!result.markup.includes('data-m='));
  assert.match(result.markup, /1\. 하루짜리 긴 제목/);
  assert.match(result.markup, /공유 시점/);
  assert.match(result.markup, />2026\.06<\/text>/);
  assert.ok(!result.markup.includes('짧은 일정 / 날짜 미정'));
});
test('empty projects render the current month and inline application script parses', () => {
  assert.equal(layout([], '2026-11-17').months[0].month, 11);
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
test('JSON restore retains roadmap fields and accepts older backups', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const source = html.slice(html.indexOf('function safe('), html.indexOf('let state;'));
  const context = vm.createContext({ Roadmap:globalThis.Roadmap, DependencyMap:globalThis.DependencyMap, id:()=> 'id', iso:()=> '2026-11-17', status:{todo:'예정',doing:'진행 중',done:'완료'} });
  vm.runInContext(source, context);
  const original = milestone('restore', '2026-06-01', '2026-06-30');
  original.flowColumn=2;
  const restored = context.safe({projects:[{milestones:[original, {title:'old', due:'2026-07-01'}]}]}).projects[0].milestones;
  for (const key of ['start','due','group','color','flowColumn']) assert.equal(restored[0][key], original[key]);
  assert.equal(restored[1].flowColumn,null);
  assert.equal(restored[1].start, '');
  assert.equal(restored[1].color, 'blue');
  assert.deepEqual(Array.from(context.safe({roadmapIds:[],projects:[]}).roadmapIds), []);
  assert.equal(context.safe({projects:[]}).roadmapIds, null);
});
test('portfolio exports only selected projects and preserves distinct rows for identical names', () => {
  const projects = [
    {id:'a',name:'같은 이름',milestones:[milestone('same-id','2026-06-01','2026-06-07')]},
    {id:'b',name:'같은 이름',milestones:[milestone('same-id','2026-06-01','2026-06-07')]},
    {id:'private',name:'공유 제외',milestones:[milestone('excluded','','2027-01-01')]},
  ];
  assert.equal(Roadmap.selectedProjects(projects, null).length, 3);
  assert.equal(Roadmap.selectedProjects(projects, []).length, 0);
  const chosen = Roadmap.selectedProjects(projects, ['a','b','deleted']);
  const combined = Roadmap.portfolio(chosen);
  assert.equal(combined.milestones.length, 2);
  assert.equal(new Set(combined.milestones.map(m=>m.id)).size, 2);
  assert.equal(layout(combined.milestones,'2026-06-01').groups.length, 2);
  assert.deepEqual(combined.milestones.map(m=>m.projectId), ['a','b']);
  assert.ok(!svg(combined,'2026-06-01',{report:true}).markup.includes('공유 제외'));
  assert.equal(projects[0].milestones[0].id, 'same-id');
});
