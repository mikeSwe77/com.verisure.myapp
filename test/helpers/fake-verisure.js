'use strict';

// A scripted stand-in for Verisure's API, used as VerisureSession's `transport`.
//
//   const server = fakeVerisure({
//     'POST /auth/login': (req) => ({ status: 200, text: '{}', setCookies: ['vid=1'] }),
//     'POST /graphql': (req, ops) => ops.map(...),   // ops = parsed request body
//   });
//   new VerisureSession({ ..., transport: server.transport });
//
// A handler may also be an array; each call shifts one response off it (the last one
// repeats). `server.calls` records { method, host, path, headers, body } for every call.

function cookieMap(header) {
  const map = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) map[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return map;
}

function normalize(response) {
  if (response instanceof Error) throw response;
  return {
    status: response.status || 200,
    text: typeof response.text === 'string' ? response.text : JSON.stringify(response.json ?? {}),
    setCookies: response.setCookies || [],
  };
}

function fakeVerisure(routes) {
  const calls = [];
  const queues = new Map();

  async function transport({
    method, url, headers, body,
  }) {
    const parsed = new URL(url);
    const pathWithQuery = parsed.pathname + parsed.search;
    const call = {
      method,
      host: parsed.host,
      path: pathWithQuery,
      headers,
      cookies: cookieMap(headers.Cookie),
      body,
    };
    calls.push(call);

    const key = `${method} ${pathWithQuery}`;
    const handler = routes[key] || routes[`${method} ${parsed.pathname}`] || routes['*'];
    if (!handler) return { status: 404, text: `No route for ${key}`, setCookies: [] };

    let current = handler;
    if (Array.isArray(handler)) {
      if (!queues.has(key)) queues.set(key, [...handler]);
      const queue = queues.get(key);
      current = queue.length > 1 ? queue.shift() : queue[0];
    }
    if (typeof current !== 'function') return normalize(current);
    const ops = body ? JSON.parse(body) : null;
    const result = await current(call, ops);
    // GraphQL handlers may return a plain array/object of results.
    if (result && (Array.isArray(result) || result.data || result.errors)) {
      return { status: 200, text: JSON.stringify(result), setCookies: [] };
    }
    return normalize(result);
  }

  return { transport, calls };
}

// GraphQL route that answers each operation by name.
function graphql(byOperation) {
  return (call, ops) => {
    const answers = ops.map((op) => {
      const name = op.operationName || (op.query.match(/(?:query|mutation)\s+(\w+)/) || [])[1];
      const answer = byOperation[name];
      if (!answer) return { errors: [{ message: `unexpected operation ${name}` }] };
      return typeof answer === 'function' ? answer(op.variables, call) : answer;
    });
    // Like the real API: a single operation comes back as a bare object.
    return answers.length === 1 ? answers[0] : answers;
  };
}

const INSTALLATIONS = {
  data: {
    account: {
      installations: [
        { giid: '111', alias: 'Home', address: { street: 'Storgatan 1' } },
      ],
    },
  },
};

module.exports = {
  fakeVerisure, graphql, cookieMap, INSTALLATIONS,
};
