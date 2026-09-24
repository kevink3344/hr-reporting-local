import { Fragment, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Announcement bodies: plain text first, with legacy Quill Delta support
// ---------------------------------------------------------------------------
// The system-wide message feature is plain text: docs/plans/system-message.md
// §5 locked that in for v1 and the composer in `SystemMessagesPage` is a
// <textarea>. But `system_messages.message` has also held Quill Delta documents
// (`{"ops":[{"insert":"…","attributes":{"italic":true}}]}`), written by an
// earlier rich-text editor and left in the table by the migration.
//
// Rendered verbatim those show up as a wall of JSON in the banner on the home
// page. So the body is parsed here: a Delta envelope is rendered as real
// paragraphs, lists and inline emphasis; every other value is rendered as plain
// text exactly as before, so nothing that works today changes shape.
//
// Emphasis is built out of React elements rather than an HTML string, so there
// is no `dangerouslySetInnerHTML` and no injection surface — and a link only
// becomes an <a> when its href is http(s) or mailto.
// ---------------------------------------------------------------------------

type Attributes = Record<string, unknown>;

type Inline = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  link: string | null;
};

type Line = {
  list: 'bullet' | 'ordered' | null;
  heading: boolean;
  quote: boolean;
  inlines: Inline[];
};

// `javascript:` / `data:` hrefs are the classic rich-text injection vector. The
// content is admin-authored but stored server-side and shown to every signed-in
// user, so only the schemes an announcement could legitimately need are honoured.
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function isRecord(value: unknown): value is Attributes {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toInlineAttrs(attributes: Attributes): Omit<Inline, 'text'> {
  const link = typeof attributes.link === 'string' ? attributes.link.trim() : '';
  return {
    bold: attributes.bold === true,
    italic: attributes.italic === true,
    underline: attributes.underline === true,
    strike: attributes.strike === true,
    code: attributes.code === true,
    link: SAFE_LINK.test(link) ? link : null,
  };
}

// Block-level attributes live on the op that contains the newline, not on the
// text: `{"insert":"\n","attributes":{"list":"bullet"}}`.
function toLineAttrs(attributes: Attributes): Pick<Line, 'list' | 'heading' | 'quote'> {
  const list = attributes.list;
  const header = attributes.header;
  return {
    list:
      list === 'bullet' || list === 'checked' || list === 'unchecked'
        ? 'bullet'
        : list === 'ordered'
          ? 'ordered'
          : null,
    heading: (typeof header === 'number' && Number.isFinite(header)) || (typeof header === 'string' && header.trim() !== ''),
    quote: attributes.blockquote === true,
  };
}

/**
 * Parse a Quill Delta document into lines, or return null when `raw` is not one.
 *
 * Returning null is the important part: a plain sentence that merely happens to
 * start with `{`, or malformed JSON, must fall through to plain-text rendering
 * rather than blanking the announcement.
 */
function parseDelta(raw: string): Line[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.ops)) return null;

  const lines: Line[] = [];
  let pending: Inline[] = [];

  for (const op of parsed.ops as unknown[]) {
    // Embedded objects (images, videos) are not part of this feature and are
    // skipped rather than rendered as "[object Object]".
    if (!isRecord(op) || typeof op.insert !== 'string') continue;
    const attributes = isRecord(op.attributes) ? op.attributes : {};
    const inline = toInlineAttrs(attributes);

    op.insert.split('\n').forEach((segment, index) => {
      if (index > 0) {
        lines.push({ ...toLineAttrs(attributes), inlines: pending });
        pending = [];
      }
      if (segment) pending.push({ ...inline, text: segment });
    });
  }
  if (pending.length > 0) lines.push({ list: null, heading: false, quote: false, inlines: pending });

  // A Quill document always ends with a newline, which would otherwise render as
  // a trailing blank paragraph in every announcement.
  while (lines.length > 0 && lines[lines.length - 1].inlines.length === 0) lines.pop();

  return lines.length > 0 ? lines : null;
}

function renderInlines(inlines: Inline[], lineKey: string): ReactNode[] {
  return inlines.map((inline, index) => {
    let node: ReactNode = inline.text;
    if (inline.code) node = <code>{node}</code>;
    if (inline.strike) node = <s>{node}</s>;
    if (inline.underline) node = <u>{node}</u>;
    if (inline.italic) node = <em>{node}</em>;
    if (inline.bold) node = <strong>{node}</strong>;
    if (inline.link) {
      node = (
        <a href={inline.link} target="_blank" rel="noreferrer noopener">
          {node}
        </a>
      );
    }
    // A keyed Fragment keeps the wrapper markup to zero while still giving each
    // run a stable key.
    return <Fragment key={`${lineKey}-${index}`}>{node}</Fragment>;
  });
}

function renderBlocks(lines: Line[]): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let listKind: 'bullet' | 'ordered' | null = null;

  const flushList = () => {
    if (listKind && listItems.length > 0) {
      const key = `list-${blocks.length}`;
      blocks.push(listKind === 'ordered' ? <ol key={key}>{listItems}</ol> : <ul key={key}>{listItems}</ul>);
    }
    listItems = [];
    listKind = null;
  };

  lines.forEach((line, index) => {
    const key = `line-${index}`;
    // A blank line is real content in a Delta, so it renders as a non-breaking
    // space rather than collapsing to zero height.
    const content = line.inlines.length > 0 ? renderInlines(line.inlines, key) : '\u00A0';

    if (line.list) {
      if (listKind && listKind !== line.list) flushList();
      listKind = line.list;
      listItems.push(<li key={key}>{content}</li>);
      return;
    }

    flushList();
    if (line.quote) blocks.push(<blockquote key={key}>{content}</blockquote>);
    else if (line.heading) blocks.push(<p className="system-message-heading" key={key}>{content}</p>);
    else blocks.push(<p key={key}>{content}</p>);
  });

  flushList();
  return blocks;
}

/**
 * Render an announcement body. Plain text keeps the exact element it had before
 * (a <span>, or a <p> in the splash) so the existing styling is untouched; a
 * legacy Delta becomes a <div> of paragraphs, lists and headings.
 */
export function SystemMessageBody({
  text,
  className,
  plainTag = 'span',
}: {
  text: string;
  className?: string;
  plainTag?: 'span' | 'p';
}) {
  const lines = parseDelta(text);
  if (!lines) {
    return plainTag === 'p' ? <p className={className}>{text}</p> : <span className={className}>{text}</span>;
  }
  return <div className={className}>{renderBlocks(lines)}</div>;
}

/**
 * Flatten an announcement to the plain text the composer and the published-list
 * preview work with. Legacy rich text stays readable instead of dumping JSON
 * into the textarea; saving it then stores plain text, which is the format the
 * feature is specified in.
 */
export function systemMessageToPlainText(raw: string): string {
  const lines = parseDelta(raw);
  if (!lines) return raw;
  return lines
    .map((line) => {
      const text = line.inlines.map((inline) => inline.text).join('');
      return line.list ? `• ${text}` : text;
    })
    .join('\n')
    .trimEnd();
}
