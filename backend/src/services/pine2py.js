import { Buffer } from 'node:buffer';

const unsupportedPatterns = [
  { regex: /strategy\.(exit|close|order)/i, reason: 'strategy.exit/order not supported' },
  { regex: /request\./i, reason: 'request.* functions are not supported' },
  { regex: /security\s*\(/i, reason: 'security() calls are not supported' },
  { regex: /plot\w*/i, reason: 'plot/plotshape are not supported' },
  { regex: /table\./i, reason: 'table.* is not supported' },
  { regex: /line\./i, reason: 'line.* is not supported' },
  { regex: /box\./i, reason: 'box.* is not supported' },
  { regex: /alertcondition/i, reason: 'alertcondition is not supported' },
  { regex: /switch\s*\(/i, reason: 'switch statements are not supported' },
  { regex: /for\s+\w+\s*=|while\s+\w+/i, reason: 'Loops are not supported' }
];

export async function buildPineConversion(pineSource) {
  const pine = typeof pineSource === 'string' ? pineSource.trim() : '';
  if (!pine) {
    throw Object.assign(new Error('Pine script is required'), { status: 400 });
  }

  const warnings = [];
  const unsupported = detectUnsupported(pine);
  let fallback = unsupported.length > 0;
  warnings.push(...unsupported);

  let python = '';
  if (!fallback) {
    const translated = translatePineToPython(pine, warnings);
    if (!translated.ok) {
      fallback = true;
      warnings.push(translated.reason);
    }
    python = fallback ? buildWebhookStub() : translated.code;
  } else {
    python = buildWebhookStub();
  }

  const readme = buildReadme({ fallback, warnings });
  const zipBuffer = buildZip([
    { name: 'strategy.py', contents: python },
    { name: 'README.md', contents: readme }
  ]);

  return { buffer: zipBuffer, preview: python, fallback, warnings };
}

function detectUnsupported(pine) {
  const hits = [];
  for (const pattern of unsupportedPatterns) {
    if (pattern.regex.test(pine)) hits.push(pattern.reason);
  }
  return hits;
}

function translatePineToPython(pine, warnings) {
  const lines = pine.replace(/\r\n/g, '\n').split('\n');
  const converted = [];
  for (const rawLine of lines) {
    const sanitized = rawLine.replace(/:=/g, '=');
    const indentMatch = sanitized.match(/^\s*/);
    const indentWidth = indentMatch ? indentMatch[0].replace(/\t/g, '    ').length : 0;
    const indentLevel = Math.floor(indentWidth / 2);
    const trimmed = sanitized.trim();
    if (!trimmed) {
      converted.push({ indentLevel: 0, text: '' });
      continue;
    }
    if (trimmed.startsWith('//@version')) continue;
    if (/^strategy\s*\(/i.test(trimmed) || /^indicator\s*\(/i.test(trimmed)) continue;

    let text = null;
    if (trimmed.startsWith('//')) {
      text = `# ${trimmed.slice(2).trim()}`;
    } else if (/^if\s*\(/i.test(trimmed) || /^if\s+/i.test(trimmed)) {
      const condition = trimmed.replace(/^if\s*/i, '');
      text = `if ${normalizeCondition(condition)}:`;
    } else if (/^else\s+if/i.test(trimmed)) {
      const condition = trimmed.replace(/^else\s+if\s*/i, '');
      text = `elif ${normalizeCondition(condition)}:`;
    } else if (/^else\b/i.test(trimmed)) {
      text = 'else:';
    } else if (/^var\s+/i.test(trimmed)) {
      text = convertAssignment(trimmed.replace(/^var\s+/i, ''), warnings);
    } else if (/^[a-zA-Z_][\w]*\s*=/.test(trimmed)) {
      text = convertAssignment(trimmed, warnings);
    } else if (/^strategy\.entry/i.test(trimmed)) {
      const entry = convertEntry(trimmed);
      if (!entry.ok) {
        return { ok: false, reason: entry.reason };
      }
      text = entry.line;
    } else {
      text = normalizeExpression(trimmed);
    }

    if (text === null) {
      return { ok: false, reason: `Unsupported statement: ${trimmed}` };
    }
    converted.push({ indentLevel, text });
  }

  const body = converted
    .map(({ indentLevel, text }) => {
      if (text === '') return '        ';
      const indent = '    '.repeat(indentLevel);
      return `        ${indent}${text}`;
    })
    .join('\n');

  const finalBody = body.trim().length ? body : '        pass';

  const code = `${pythonHeader()}\n${finalBody}\n${pythonHelper()}`;
  return { ok: true, code };
}

function convertAssignment(statement, warnings) {
  const match = statement.match(/^([a-zA-Z_][\w]*)\s*=\s*(.+)$/);
  if (!match) return normalizeExpression(statement);
  const [, name, expr] = match;
  if (/^input\./i.test(expr)) {
    const defVal = extractInputDefault(expr);
    if (defVal === 'None') warnings.push(`Parameter ${name} missing explicit defval; defaulting to None`);
    return `${name} = params.get('${name}', ${defVal})`;
  }
  return `${name} = ${normalizeExpression(expr)}`;
}

function extractInputDefault(expr) {
  const start = expr.indexOf('(');
  const end = expr.lastIndexOf(')');
  if (start === -1 || end === -1) return 'None';
  const args = splitArgs(expr.slice(start + 1, end));
  for (const arg of args) {
    const [key, value] = arg.split('=');
    if (key && key.trim() === 'defval' && typeof value !== 'undefined') {
      return normalizeExpression(value.trim());
    }
  }
  return 'None';
}

function convertEntry(statement) {
  const start = statement.indexOf('(');
  const end = statement.lastIndexOf(')');
  if (start === -1 || end === -1) {
    return { ok: false, reason: 'Unable to parse strategy.entry call' };
  }
  const args = splitArgs(statement.slice(start + 1, end));
  const label = args[0] ? normalizeExpression(args[0]) : `'trade'`;
  let direction = args[1] ? normalizeExpression(args[1]) : `'long'`;
  const namedQty = args.find((arg) => arg.trim().startsWith('qty'));
  let qty = 'None';
  if (namedQty) {
    const [, value] = namedQty.split('=');
    qty = value ? normalizeExpression(value.trim()) : 'None';
  } else if (args.length >= 3) {
    qty = normalizeExpression(args[2]);
  }
  if (/strategy\.long/i.test(direction)) direction = `'long'`;
  if (/strategy\.short/i.test(direction)) direction = `'short'`;
  return { ok: true, line: `self.enter(ctx, ${label}, side=${direction}, qty=${qty})` };
}

function normalizeCondition(condition) {
  let expr = condition.trim();
  if (expr.startsWith('(') && expr.endsWith(')')) {
    expr = expr.slice(1, -1).trim();
  }
  return normalizeExpression(expr);
}

function normalizeExpression(expr) {
  return expr
    .trim()
    .replace(/strategy\.long/gi, "'long'")
    .replace(/strategy\.short/gi, "'short'")
    .replace(/true/gi, 'True')
    .replace(/false/gi, 'False')
    .replace(/na/gi, 'None');
}

function splitArgs(body) {
  const args = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function pythonHeader() {
  return [
    '"""Generated from TradingView Pine via DaxLinks helper."""',
    'from pendax_sdk import Strategy',
    'from pendax_sdk import indicators as ta',
    '',
    'class GeneratedStrategy(Strategy):',
    '    def __init__(self):',
    '        super().__init__()',
    '',
    '    def on_bar(self, ctx):',
    '        open_ = ctx.open',
    '        high = ctx.high',
    '        low = ctx.low',
    '        close = ctx.close',
    '        volume = ctx.volume',
    '        params = getattr(ctx, "params", {}) or {}',
    ''
  ].join('\n');
}

function pythonHelper() {
  return [
    '',
    '    def enter(self, ctx, label, side="long", qty=None):',
    '        """Basic helper that routes orders through the SDK context."""',
    '        if hasattr(ctx, "orders") and hasattr(ctx.orders, "submit"):',
    '            ctx.orders.submit(label=label, side=side, qty=qty)',
    '        elif hasattr(ctx, "log"):',
    '            ctx.log(f"{label} {side} qty={qty}")',
    '        else:',
    '            print(f"Order {label} {side} qty={qty}")',
    ''
  ].join('\n');
}

function buildWebhookStub() {
  return [
    '"""Webhook fallback stub for Pine features that cannot be auto-converted."""',
    'import json',
    'import requests',
    '',
    'WEBHOOK_URL = "https://api.daxlinks.local/webhook"  # Replace with your endpoint',
    '',
    'def forward_alert(payload: dict) -> None:',
    '    response = requests.post(WEBHOOK_URL, json=payload, timeout=10)',
    '    response.raise_for_status()',
    '',
    'if __name__ == "__main__":',
    '    sample_payload = {"symbol": "BTCUSDT", "side": "buy"}',
    '    print("Forwarding sample alert", json.dumps(sample_payload))',
    '    forward_alert(sample_payload)'
  ].join('\n');
}

function buildReadme({ fallback, warnings }) {
  const mode = fallback ? 'Webhook (fallback)' : 'Python strategy';
  const lines = [
    '# Pine Conversion',
    '',
    `Mode: ${mode}`,
    '',
    'Generated by the DaxLinks Pine Helper. Drop these files into your bot workspace and tweak as needed.',
    '',
    '## Quick start'
  ];
  if (fallback) {
    lines.push(
      '1. Configure TradingView alerts to hit your DaxLinks webhook.',
      '2. Use `strategy.py` as a reference implementation for forwarding payloads.',
      '3. Move complex logic into your existing webhook handlers.'
    );
  } else {
    lines.push(
      '1. `pip install pendax-sdk pandas numpy ta` (or your preferred TA package).',
      '2. Customize `strategy.py` within the SDK scaffold.',
      '3. Implement exchange plumbing inside `ctx.orders.submit` as appropriate.',
      '4. Zip and upload via the DaxLinks builder to create a runnable bot.'
    );
  }
  if (warnings.length) {
    lines.push('', '## Warnings');
    warnings.forEach((warn) => lines.push(`- ${warn}`));
  }
  lines.push('', 'Generated at ' + new Date().toISOString());
  return lines.join('\n');
}

function buildZip(files) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  const now = new Date();
  const dosTime = toDosTime(now);
  const dosDate = toDosDate(now);

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.from(file.contents, 'utf8');
    const crc = crc32(dataBuf);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8); // stored (no compression)
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc >>> 0, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(filenameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    parts.push(localHeader, filenameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc >>> 0, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(filenameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centrals.push(centralHeader, filenameBuf);

    offset += localHeader.length + filenameBuf.length + dataBuf.length;
  }

  const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0);
  const centralOffset = parts.reduce((sum, buf) => sum + buf.length, 0);

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralSize, 12);
  endRecord.writeUInt32LE(centralOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, ...centrals, endRecord]);
}

function toDosTime(date) {
  const seconds = Math.floor(date.getSeconds() / 2);
  return (date.getHours() << 11) | (date.getMinutes() << 5) | seconds;
}

function toDosDate(date) {
  const year = Math.max(1980, date.getFullYear());
  return ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

export default buildPineConversion;
