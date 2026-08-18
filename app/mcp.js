'use strict';
/*
 * tovo - MCP-server (Model Context Protocol).
 *
 * Streamable HTTP + JSON-RPC 2.0, haandskrevet. MCP ER bare JSON-RPC over
 * HTTP POST, saa der er ingen grund til en pakke - og dermed ingen
 * forsyningskaede at holde patchet (§9a).
 *
 * Vaerktoejerne kalder de SAMME funktioner som webappen: parse.js til
 * syntaksen, beregn.js til alle tal. **Der findes ingen saerlig MCP-vej ind
 * i dataene** - ellers ville en ugerapport hentet af Claude kunne vise noget
 * andet end den, der staar paa skaermen (Beanledger v28).
 *
 * tovo er FLERBRUGER, saa hvert eneste kald bruger `auth.user.id`. Doda
 * kunne noejes med "den ene bruger"; her ville det vaere en laekage.
 */

const PROTOKOL = '2025-06-18';
const PROTOKOLLER = ['2025-06-18', '2025-03-26', '2024-11-05'];

function opret(srv) {
  const f = (m) => srv.beregn.formatVarighed(m);

  /* ---------------------------------------------------------- vaerktoejer */

  const VAERKTOEJER = [
    {
      name: 'capture',
      scope: 'capture',
      description:
        'Create a task in tovo. Takes the WHOLE capture line with the same shortcut syntax as '
        + 'the app: @project (or /project), #tag, !date (!tomorrow, !friday, !3/9, !in 2 weeks), '
        + '~estimate (~2t, ~90m, ~1,5t — Danish decimal comma works), '
        + ':case-number (the number the hours are booked against in another system), '
        + '% anywhere in the line to start the timer on it right away, '
        + '!every monday for a repeating task, and " // " to start a description. '
        + 'Unknown projects and tags are created automatically.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The full capture line, syntax included.' } },
        required: ['text'],
      },
      kald(a, auth) {
        const r = srv.fangst(auth.user.id, String(a.text || ''), { kilde: 'mcp' });
        const i = r.item;
        const dele = [`Created: ${i.title}`];
        if (i.projectId) {
          const p = srv.hentItem(auth.user.id, i.projectId);
          if (p) dele.push(`Project: ${p.name}`);
        }
        if (i.estimateMinutes) dele.push(`Estimate: ${f(i.estimateMinutes)}`);
        if (i.dueDate) dele.push(`Due: ${i.dueDate}${i.dueTime ? ` ${i.dueTime}` : ''}`);
        if (r.recurrenceText) dele.push(`Repeats: ${r.recurrenceText}`);
        if (r.timer) dele.push('The timer is now running on it.');
        for (const w of r.warnings) dele.push(`Note: ${w}`);
        dele.push(`id: ${i.id}`);
        return { tekst: dele.join('\n'), data: { item: i } };
      },
    },

    {
      name: 'search',
      scope: 'read',
      description: 'Search tasks and projects by name. Use this to find the id of something '
        + 'before acting on it.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          project: { type: 'string', description: 'Limit to one project id. Optional.' },
        },
        required: ['query'],
      },
      kald(a, auth) {
        const r = srv.soeg(auth.user.id, String(a.query || ''), { projectId: a.project || null });
        const linjer = [
          ...r.projects.map((p) => `- PROJECT ${p.name}  [id: ${p.id}]`),
          ...r.tasks.map((t) => opgaveLinje(t, auth)),
        ];
        return { tekst: linjer.join('\n') || 'No matches.', data: r };
      },
    },

    {
      name: 'list_projects',
      scope: 'read',
      description: 'List the projects with their estimate, budget and time spent.',
      inputSchema: { type: 'object', properties: {} },
      kald(a, auth) {
        const b = srv.beregnFor(auth.user.id);
        const projekter = srv.hentItems(auth.user.id, { kind: 'project' }).filter((p) => !p.archivedAt);
        const linjer = projekter.map((p) => {
          const r = b.rollupProjekt(p.id);
          const ramme = r.ramme ? `, budget ${f(r.ramme)}` : '';
          return `- ${p.name}${p.customer ? ` (${p.customer})` : ''}: `
            + `${r.aabne} open, estimated ${f(r.estimat)}${ramme}, spent ${f(r.forbrugt)}  [id: ${p.id}]`;
        });
        return { tekst: linjer.join('\n') || 'No projects yet.', data: { projects: projekter } };
      },
    },

    {
      name: 'project_status',
      scope: 'read',
      description: 'The three numbers for one project — the sum of task estimates, the agreed '
        + 'budget and the time actually spent — plus the task list.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      kald(a, auth) {
        const p = srv.hentItem(auth.user.id, String(a.id || ''));
        if (!p || p.kind !== 'project') return { fejl: `No project with id ${a.id}.` };
        const b = srv.beregnFor(auth.user.id);
        const r = b.rollupProjekt(p.id);
        const opgaver = srv.hentItems(auth.user.id, { kind: 'task' }).filter((t) => t.projectId === p.id);
        const linjer = [
          `${p.name}${p.customer ? ` — ${p.customer}` : ''}`,
          `Estimated: ${f(r.estimat)} (${r.opgaver} tasks)`,
          `Budget: ${r.ramme ? f(r.ramme) : 'not set'}`,
          `Spent: ${f(r.forbrugt)}`,
          r.resterende === null ? 'Left: no budget set' : `Left: ${f(Math.max(0, r.resterende))} (${r.procent}% used)`,
        ];
        if (r.estimatOverRamme) linjer.push('The estimates add up to more than the budget.');
        linjer.push('', ...opgaver.map((t) => `- ${t.title}: estimated `
          + `${t.estimateMinutes ? f(t.estimateMinutes) : '—'}, spent ${f(b.forbrugPaaOpgave(t.id))}`
          + `${t.status === 'done' ? ' ✓' : ''}  [id: ${t.id}]`));
        return { tekst: linjer.join('\n'), data: { project: p, rollup: r, tasks: opgaver } };
      },
    },

    {
      name: 'start_timer',
      scope: 'write',
      description: 'Start the timer on a task. A timer that is already running is stopped first '
        + '— there can only be one.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Task id.' } },
        required: ['id'],
      },
      kald(a, auth) {
        const opgave = srv.hentItem(auth.user.id, String(a.id || ''));
        if (!opgave || opgave.kind !== 'task') return { fejl: `No task with id ${a.id}.` };
        const r = srv.startTimer(auth.user.id, opgave.id, 'mcp');
        const t = srv.timerStatus(auth.user.id);
        return {
          tekst: `Timer running on: ${t.taskTitle}`
            + (r.stopped ? `\nStopped the one that was running (${f(srv.beregnFor(auth.user.id).varighed(r.stopped))}).` : ''),
          data: { timer: t },
        };
      },
    },

    {
      name: 'stop_timer',
      scope: 'write',
      description: 'Stop the running timer.',
      inputSchema: { type: 'object', properties: {} },
      kald(a, auth) {
        const post = srv.stopTimer(auth.user.id);
        if (!post) return { tekst: 'No timer was running.' };
        const opgave = srv.hentItem(auth.user.id, post.taskId);
        const minutter = srv.beregnFor(auth.user.id).varighed(post);
        return {
          tekst: `Stopped after ${f(minutter)} on: ${opgave ? opgave.title : 'a deleted task'}`,
          data: { entry: post },
        };
      },
    },

    {
      name: 'current_timer',
      scope: 'read',
      description: 'What is running right now, and for how long.',
      inputSchema: { type: 'object', properties: {} },
      kald(a, auth) {
        const t = srv.timerStatus(auth.user.id);
        if (!t) return { tekst: 'Nothing is running.', data: { timer: null } };
        return {
          tekst: `${t.taskTitle}${t.projectName ? ` (${t.projectName})` : ''} — running for ${f(t.minutes)}`
            + (t.tooLong ? '\nIt has been running for a long time. Is that right?' : ''),
          data: { timer: t },
        };
      },
    },

    {
      name: 'log_time',
      scope: 'write',
      description:
        'Log time on a task afterwards — the most useful tool when the timer was forgotten. '
        + 'The time is either a range (9-11.30) or a duration (1,5t · 90m · 1t30m). '
        + 'The date defaults to today.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task id.' },
          time: { type: 'string', description: '"9-11.30", "1,5t", "90m" or "1t30m".' },
          date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
          note: { type: 'string' },
        },
        required: ['id', 'time'],
      },
      kald(a, auth) {
        const opgave = srv.hentItem(auth.user.id, String(a.id || ''));
        if (!opgave || opgave.kind !== 'task') return { fejl: `No task with id ${a.id}.` };
        const dato = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '')) ? a.date : srv.iDag();
        // SAMME parser som feltet i webappen. To tolkninger ville betyde, at
        // "1,5t" kunne blive halvfems minutter ét sted og noget andet et andet.
        const tidsrum = srv.beregn.parseTidsrum(String(a.time || ''), dato);
        if (!tidsrum) return { fejl: `I did not understand "${a.time}". Try 9-11.30, 1,5t, 90m or 1t30m.` };
        const dagens = srv.hentPoster(auth.user.id, {
          fra: srv.dagStart(dato), til: srv.dagStart(dato) + 86400,
        });
        const plads = tidsrum.fra
          ? { startedAt: srv.beregn.tidspunkt(dato, tidsrum.fra), stoppedAt: srv.beregn.tidspunkt(dato, tidsrum.til) }
          : srv.beregn.placerVarighed(dagens, dato, tidsrum.minutter);
        const post = srv.gemPost(auth.user.id, {
          taskId: opgave.id, startedAt: plads.startedAt, stoppedAt: plads.stoppedAt,
          note: String(a.note || ''), source: 'mcp',
        });
        return {
          tekst: `Logged ${f(tidsrum.minutter)} on ${dato}: ${opgave.title}`,
          data: { entry: post },
        };
      },
    },

    {
      name: 'week_report',
      scope: 'read',
      description:
        'Hours for a week, grouped by project and task, with estimate against spent, the split '
        + 'between projects and ad hoc, and a comparison with the normal week. Defaults to the '
        + 'current week. These are exactly the numbers the app shows.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD, the Monday. Defaults to this week.' },
          to: { type: 'string', description: 'YYYY-MM-DD, inclusive. Defaults to from + 6 days.' },
        },
      },
      kald(a, auth) {
        const fra = /^\d{4}-\d{2}-\d{2}$/.test(String(a.from || '')) ? a.from : srv.ugeStart(srv.iDag());
        const til = /^\d{4}-\d{2}-\d{2}$/.test(String(a.to || '')) ? a.to : srv.ugeSlut(fra);
        const b = srv.beregnFor(auth.user.id);
        const r = b.ugerapport(srv.dagStart(fra), srv.dagStart(til) + 86400);
        const linjer = [`${fra} – ${til}: ${f(r.total)} in total`,
          `On projects: ${f(r.onProjects)} · Ad hoc: ${f(r.adhoc)} · Completed: ${r.completed}`];
        if (r.norm) linjer.push(`Against ${f(r.norm)} normal hours: ${r.overNorm >= 0 ? '+' : '−'}${f(Math.abs(r.overNorm))}`);
        // Pr. sag PR. DAG - det er den opgoerelse, timerne skrives af fra.
        const ts = b.timeseddel(srv.dagStart(fra), srv.dagStart(til) + 86400);
        if (ts.caseRows.length) {
          linjer.push('', 'Per case number, per day:');
          for (const c of ts.caseRows) {
            const dage = ts.dage.filter((iso) => c.dage[iso])
              .map((iso) => `${iso}: ${f(c.dage[iso])}`).join(' · ');
            linjer.push(`  ${c.case || '(no case number)'} — ${f(c.total)}${dage ? ` (${dage})` : ''}`);
          }
        }
        for (const p of r.projects) {
          linjer.push('', `${p.name} — ${f(p.minutter)}`);
          for (const t of p.tasks) {
            linjer.push(`  - ${t.title}: ${f(t.minutter)}`
              + (t.estimateMinutes ? ` (estimated ${f(t.estimateMinutes)})` : '')
              + (t.completedIPerioden ? ' ✓ completed' : ''));
          }
        }
        const tynde = r.days.filter((d) => d.tynd || d.tom);
        if (tynde.length) linjer.push('', `Thin days: ${tynde.map((d) => d.date).join(', ')} — probably forgotten registration.`);
        return { tekst: linjer.join('\n'), data: { report: r, timesheet: ts } };
      },
    },

    {
      name: 'complete_task',
      scope: 'write',
      description: 'Mark a task as done. If it repeats, the next occurrence is created.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      kald(a, auth) {
        const opgave = srv.hentItem(auth.user.id, String(a.id || ''));
        if (!opgave || opgave.kind !== 'task') return { fejl: `No task with id ${a.id}.` };
        if (opgave.status === 'done') return { tekst: `Already done: ${opgave.title}` };
        const r = srv.fuldfoer(auth.user.id, opgave);
        return {
          tekst: `Done: ${opgave.title}`
            + (r.next ? `\nNext occurrence: ${r.next.dueDate}  [id: ${r.next.id}]` : ''),
          data: r,
        };
      },
    },

    {
      name: 'duplicate_task',
      scope: 'write',
      description: 'Make a copy of a task. The copy keeps the notes, project, column, '
        + 'estimate, due date, case number, tags and links, and starts as open. Logged '
        + 'time, comments, the start link and any repeat rule stay on the original only.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string', description: 'Title for the copy. Defaults to "<original> (copy)".' },
        },
        required: ['id'],
      },
      kald(a, auth) {
        const opgave = srv.hentItem(auth.user.id, String(a.id || ''));
        if (!opgave || opgave.kind !== 'task') return { fejl: `No task with id ${a.id}.` };
        // Samme funktion som webappens knap. Der maa ikke findes en saerlig
        // MCP-vej ind i dataene.
        const kopi = srv.dupliker(auth.user.id, opgave, a.title);
        return { tekst: `Copied: ${kopi.title}  [id: ${kopi.id}]`, data: { item: kopi } };
      },
    },

    {
      name: 'update_task',
      scope: 'write',
      description: 'Change a task: title, due date, priority or project.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          due: { type: 'string', description: 'YYYY-MM-DD, or "" to clear it.' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          project: { type: 'string', description: 'Project id, or "" for no project.' },
        },
        required: ['id'],
      },
      kald(a, auth) {
        const opgave = srv.hentItem(auth.user.id, String(a.id || ''));
        if (!opgave || opgave.kind !== 'task') return { fejl: `No task with id ${a.id}.` };
        const felter = {};
        if (a.title !== undefined) felter.title = String(a.title);
        if (a.due !== undefined) felter.dueDate = a.due || null;
        if (a.priority !== undefined) felter.priority = a.priority || null;
        if (a.project !== undefined) {
          if (a.project) {
            const p = srv.hentItem(auth.user.id, String(a.project));
            if (!p || p.kind !== 'project') return { fejl: `No project with id ${a.project}.` };
          }
          felter.projectId = a.project || null;
        }
        const ny = srv.gemItem(auth.user.id, Object.assign({}, opgave, felter));
        return { tekst: `Updated: ${ny.title}`, data: { item: ny } };
      },
    },

    {
      name: 'set_estimate',
      scope: 'write',
      description: 'Set the estimate on a task. Same syntax as the ~ token: 2t · 90m · 1,5t · 1t30m.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          estimate: { type: 'string', description: 'e.g. "2,5t". Empty string clears it.' },
        },
        required: ['id', 'estimate'],
      },
      kald(a, auth) {
        const opgave = srv.hentItem(auth.user.id, String(a.id || ''));
        if (!opgave || opgave.kind !== 'task') return { fejl: `No task with id ${a.id}.` };
        let minutter = null;
        if (String(a.estimate || '').trim()) {
          minutter = srv.beregn.parseVarighed(String(a.estimate));
          if (!minutter) return { fejl: `I did not understand "${a.estimate}" as a duration.` };
        }
        const ny = srv.gemItem(auth.user.id, Object.assign({}, opgave, { estimateMinutes: minutter }));
        return {
          tekst: minutter ? `Estimate on "${ny.title}": ${f(minutter)}` : `Estimate cleared on "${ny.title}"`,
          data: { item: ny },
        };
      },
    },
  ];

  function opgaveLinje(t, auth) {
    const dele = [t.title];
    if (t.projectId) {
      const p = srv.hentItem(auth.user.id, t.projectId);
      if (p) dele.push(p.name);
    }
    if (t.dueDate) dele.push(`due ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}`);
    if (t.estimateMinutes) dele.push(`est. ${f(t.estimateMinutes)}`);
    if (t.status === 'done') dele.push('done');
    return `- ${dele.join('  ·  ')}  [id: ${t.id}]`;
  }

  /* -------------------------------------------------------- json-rpc */

  const fejl = (id, kode, besked, data) => ({
    jsonrpc: '2.0', id: id === undefined ? null : id,
    error: Object.assign({ code: kode, message: besked }, data ? { data } : {}),
  });
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

  function behandl(besked, auth) {
    if (!besked || besked.jsonrpc !== '2.0' || typeof besked.method !== 'string') {
      return fejl(besked && besked.id, -32600, 'Invalid Request');
    }
    const { id, method, params } = besked;

    if (method === 'initialize') {
      const oensket = params && params.protocolVersion;
      return ok(id, {
        protocolVersion: PROTOKOLLER.includes(oensket) ? oensket : PROTOKOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'tovo', title: 'tovo', version: String(srv.version) },
        instructions:
          'tovo is a personal time tracker for tasks and projects. A task belongs to a project; '
          + 'time is always logged on a task. Capture with the shortcut syntax (@project, #tag, '
          + '!date, ~estimate) rather than filling in fields one by one. A project has three '
          + 'numbers that mean different things: the sum of task estimates, the agreed budget, '
          + 'and the time actually spent. Never invent ids — find them with search or '
          + 'list_projects first.',
      });
    }
    if (method === 'ping') return ok(id, {});
    // Notifikationer (uden id) besvares med 202 og TOM krop. Svarer man med
    // JSON, brokker klienten sig.
    if (method.startsWith('notifications/')) return null;

    if (method === 'tools/list') {
      // Vis kun det, noeglen maa. Saa foreslaar modellen ikke noget, der
      // alligevel giver 403 - men listen er en hjaelp, ikke en spaerring.
      return ok(id, {
        tools: VAERKTOEJER.filter((v) => srv.maa(auth, v.scope)).map((v) => ({
          name: v.name, description: v.description, inputSchema: v.inputSchema,
        })),
      });
    }

    if (method === 'tools/call') {
      const navn = params && params.name;
      const v = VAERKTOEJER.find((x) => x.name === navn);
      if (!v) return fejl(id, -32602, `Unknown tool: ${navn}`);
      // ... og haandhaev det ALLIGEVEL her.
      if (!srv.maa(auth, v.scope)) {
        return ok(id, {
          isError: true,
          content: [{ type: 'text', text: `This key is "${auth.token.scope}" and cannot ${v.scope}. `
            + 'Create a key with a wider scope in tovo under Settings.' }],
        });
      }
      let svar;
      try {
        svar = v.kald((params && params.arguments) || {}, auth);
      } catch (err) {
        srv.logError(`mcp ${navn}: ${err && err.stack ? err.stack : err}`);
        return ok(id, { isError: true, content: [{ type: 'text', text: 'The tool failed. See the tovo server log.' }] });
      }
      // Fejl fra et VAERKTOEJ er ikke protokolfejl: de skal tilbage som et
      // resultat med isError, saa modellen kan laese og rette op. Blander man
      // dem, kan den ikke skelne "du skrev forkert" fra "serveren er i stykker".
      if (svar.fejl) return ok(id, { isError: true, content: [{ type: 'text', text: svar.fejl }] });
      return ok(id, Object.assign(
        { content: [{ type: 'text', text: svar.tekst }] },
        svar.data ? { structuredContent: svar.data } : {},
      ));
    }

    return fejl(id, -32601, `Method not found: ${method}`);
  }

  /* ------------------------------------------------------------ http */

  async function haandter(req, res) {
    if (req.method === 'GET' || req.method === 'DELETE') {
      // Der er ingen serverstyret SSE-stroem: alt besvares i selve POST-svaret.
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'method_not_allowed', message: 'tovo answers MCP on POST only.' }));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

    // DNS-rebinding: en browser paa et fremmed site maa ikke kunne naa den
    // her. Klienter uden browser sender ingen Origin, og saa er der intet
    // at tjekke.
    const origin = req.headers.origin;
    if (origin) {
      const vaert = req.headers['x-forwarded-host'] || req.headers.host || '';
      let god = false;
      try { god = new URL(origin).host === String(vaert).split(',')[0].trim(); } catch { god = false; }
      if (!god) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_origin', message: 'Origin not allowed.' }));
        return;
      }
    }

    const auth = srv.godkendMcp(req);
    if (!auth) {
      /*
       * HELE indgangen er denne header.
       *
       * Uden `resource_metadata` kan claude.ai ikke opdage autorisations-
       * serveren og opgiver forbindelsen - UDEN at noget ser i stykker ud.
       * Verificér med: curl -si …/mcp | grep -i www-authenticate
       */
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': srv.oauthUdfordring(req),
      });
      res.end(JSON.stringify({
        error: 'invalid_key',
        message: 'Send a valid tovo access key as "Authorization: Bearer tovo_…", or connect with OAuth.',
      }));
      return;
    }

    let krop;
    try {
      krop = await srv.readJsonBody(req, true, true);   // tilladArray: JSON-RPC-batch
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fejl(null, -32700, 'Parse error')));
      return;
    }

    const flere = Array.isArray(krop);
    const beskeder = flere ? krop : [krop];
    const svar = beskeder.map((b) => behandl(b, auth)).filter(Boolean);
    if (!svar.length) { res.writeHead(202); res.end(); return; }

    const data = JSON.stringify(flere ? svar : svar[0]);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'MCP-Protocol-Version': PROTOKOL,
      'Content-Length': Buffer.byteLength(data),
    });
    res.end(data);
  }

  return { haandter, VAERKTOEJER, behandl };
}

module.exports = { opret, PROTOKOL };
