import { h, mount, num, toast } from './dom.js';
import { StatTile } from './components.js';
import {
  importFiles, getTournaments, setType, removeTournament, clearAll, getScreenNames, setScreenNames,
} from '../data/datastore.js';

const TYPES = { vanilla: 'Vanilla', ko: 'KO', mystery: 'Mystery KO' };
const filter = { type: 'all', room: 'all' };
const eur = (x) => (Number.isFinite(x) ? x.toFixed(2).replace('.', ',') + ' €' : '–');
const signed = (x) => (x > 0 ? '+' : '') + eur(x);

let root;
export function renderMyData(el) {
  root = el;
  render();
}

async function readFiles(fileList) {
  const files = [];
  for (const f of fileList) {
    if (!/\.txt$/i.test(f.name)) continue;
    files.push({ name: f.name, text: await f.text() });
  }
  if (!files.length) { toast('Choose .txt files'); return; }
  const rep = importFiles(files);
  const msg = `${rep.ok} file${rep.ok > 1 ? 's' : ''} read · ${rep.tournaments.size} tournament${rep.tournaments.size > 1 ? 's' : ''} · ${rep.decisions} decisions for Leakfinder`;
  toast(rep.saved ? msg : 'Storage is full: the browser could not save everything');
  lastReport = rep;
  render();
}
let lastReport = null;

function render() {
  const all = getTournaments();
  const list = all.filter((t) => (filter.type === 'all' || t.type === filter.type) && (filter.room === 'all' || t.room === filter.room));
  const done = list.filter((t) => !t.running);
  const cost = done.reduce((a, t) => a + (t.cost || 0), 0);
  const won = done.reduce((a, t) => a + (t.winnings || 0), 0);
  const itm = done.filter((t) => (t.prize || 0) > 0).length;
  const rooms = [...new Set(all.map((t) => t.room))];

  const input = h('input', { type: 'file', multiple: true, accept: '.txt', hidden: true, on: { change: (e) => readFiles(e.target.files) } });
  const drop = h('div.dropzone', {
    tabindex: '0', role: 'button', 'aria-label': 'Import tournament files',
    on: {
      click: () => input.click(),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
      dragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      dragleave: () => drop.classList.remove('over'),
      drop: (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); },
    },
  }, input, h('strong', 'Drop your tournament files here, or click to choose'),
  h('span.muted.small', 'Two .txt files per tournament: the summary and the hand history. Files are read in your browser and never leave it.'));

  mount(root, h('div.data-page',
    h('div.row.between', h('h1', 'My Data'),
      all.length ? h('button.btn.ghost.sm', { type: 'button', on: { click: () => { if (confirm('Delete all imported tournaments from this browser?')) { clearAll(); render(); } } } }, 'Delete all') : null),
    drop,
    lastReport?.errors.length ? h('div.panel.warn', h('strong', 'Some files were not read'), h('ul', lastReport.errors.slice(0, 8).map((e) => h('li.small', e)))) : null,
    h('details.help', h('summary', 'Where are my files?'),
      h('ul.small',
        h('li', h('strong', 'PokerStars: '), 'summaries in %LOCALAPPDATA%\\PokerStars.FR\\TournSummary\\<your name>, hands in …\\HandHistory\\<your name>. In the client, turn on Settings → Playing History → "Save my hand histories".'),
        h('li', h('strong', 'Winamax: '), 'Options → Hand histories, then the "history" folder of your account.'),
        h('li', h('strong', 'PMU, Betclic: '), 'not supported yet. Send one tournament (its two files) and the format gets added.'))),
    h('div.field.names', h('div.field-label', 'My screen names'),
      h('input.text', {
        type: 'text', value: getScreenNames().join(', '), placeholder: 'e.g. Goodrhum',
        on: { change: (e) => { setScreenNames(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)); render(); } },
      })),
    all.length ? h('div.row.gap.wrap',
      h('label.pick-field', 'Type', h('select', { on: { change: (e) => { filter.type = e.target.value; render(); } } },
        [['all', 'All'], ...Object.entries(TYPES)].map(([v, l]) => h('option', { value: v, selected: filter.type === v }, l)))),
      rooms.length > 1 ? h('label.pick-field', 'Room', h('select', { on: { change: (e) => { filter.room = e.target.value; render(); } } },
        ['all', ...rooms].map((r) => h('option', { value: r, selected: filter.room === r }, r === 'all' ? 'All' : r)))) : null) : null,
    all.length ? h('div.stats-row.wide',
      StatTile('Tournaments', done.length, list.length > done.length ? `${list.length - done.length} still running` : null),
      StatTile('Total buy-ins', eur(cost)),
      StatTile('Total won', eur(won)),
      StatTile('Profit', h('span', { class: won - cost >= 0 ? 'pos' : 'neg' }, signed(won - cost))),
      StatTile('ROI', cost ? ((won - cost) / cost * 100).toFixed(1) + '%' : '–', `ITM ${done.length ? Math.round(itm / done.length * 100) : 0}%`)) : null,
    all.length ? h('div.table-wrap', h('table.data',
      h('thead', h('tr', h('th', 'Date'), h('th', 'Tournament'), h('th', 'Type'), h('th', 'Buy-in'), h('th', 'Players'), h('th', 'Prize pool'),
        h('th', 'Place'), h('th', 'Net result'), h('th', 'Profit'), h('th', 'Files'), h('th', ''))),
      h('tbody', list.map((t) => h('tr',
        h('td.mono', t.date || '–'),
        h('td', h('div', t.name), h('div.small.muted', `${t.room} #${t.tid}`)),
        h('td', h('select.inline', { 'aria-label': 'Tournament type', on: { change: (e) => { setType(t.key, e.target.value); render(); } } },
          Object.entries(TYPES).map(([v, l]) => h('option', { value: v, selected: t.type === v }, l)))),
        h('td.mono', eur(t.buyin), t.reentries ? h('div.small.muted', `+${t.reentries} re-entr${t.reentries > 1 ? 'ies' : 'y'}`) : null),
        h('td.mono', t.players || '–'),
        h('td.mono', eur(t.prizePool)),
        h('td.mono', t.running ? 'running' : t.place ? `${t.place}${t.players ? ' / ' + t.players : ''}` : '–'),
        h('td.mono', eur(t.winnings), t.bounties ? h('div.small.muted', `incl. ${eur(t.bounties)} bounties`) : null),
        h('td.mono', { class: t.running ? '' : t.profit >= 0 ? 'pos' : 'neg' }, t.running ? '–' : signed(t.profit)),
        h('td.small', ['summary', 'hands'].map((f) => h('span.file-tag' + (t.files.includes(f) ? '.on' : ''), { title: t.files.includes(f) ? `${f} imported` : `${f} missing` }, f === 'summary' ? 'S' : 'H')),
          t.handsCount ? h('div.muted', `${t.handsCount} hands`) : null),
        h('td', h('button.icon-btn', { type: 'button', 'aria-label': 'Remove tournament', title: 'Remove', on: { click: () => { removeTournament(t.key); render(); } } }, '✕'))))))) :
      h('div.empty-state', h('p.muted', 'No tournaments yet. Import your files to see your results here, then open Leakfinder.')),
  ));
}

export const fmtEur = eur;
export { num };
