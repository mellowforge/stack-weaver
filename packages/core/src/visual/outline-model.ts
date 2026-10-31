import { describeNode } from '../document/describe.js';
import type { NodeView } from '../document/describe.js';
import { isEmptyDocument } from '../document/data.js';
import type { EditRefusal } from '../document/edit.js';
import type { NodeRef, ParsedText } from '../document/types.js';
import type { UiMessages } from '../editor/messages.js';
import type { FormatDefinition } from '../formats/types.js';
import { isRecord, safeData } from './util.js';

/**
 * One node of the outline tree: a document, or a mapping or sequence inside it.
 * @internal
 */
export interface OutlineNode {
  /** Stable id: `${doc}:${path.join('/')}`. */
  readonly id: string;
  /** The node in the document. */
  readonly ref: NodeRef;
  /**
   * What the user reads: a document's kind label and name (`Document N`, numbered from 1, when it
   * has no kind), a map key's label, or a sequence item's name (`Item N` when it has none).
   */
  readonly label: string;
  /** Document root, mapping or sequence; `variables` is the Variables section, which has no node in the text. */
  readonly type: 'document' | 'map' | 'seq' | 'variables';
  /** Only mapping and sequence children; scalars are not outline nodes. */
  readonly children: readonly OutlineNode[];
  /** Why the node cannot be edited visually. */
  readonly readOnly?: EditRefusal;
  /** A document of a kind the format has no schema for: shown as a card, with no children. */
  readonly unknownKind?: boolean;
}

/** The id of the outline node at `ref`. */
export function nodeId(ref: NodeRef): string {
  return `${ref.doc}:${ref.path.join('/')}`;
}

const MAX_DEPTH = 40;

const unique = (keys: readonly string[]): string[] => [...new Set(keys)];

/**
 * Builds the outline of `p`: for `documents` formats one root per non-empty document, for `mapping`
 * formats one root per top-level key of document 0.
 * @param labelFor - Label of a map key; called with `path: []` for a document root and the document's `kind`.
 * @param isUnknown - Whether a document with this `apiVersion` and `kind` has no schema.
 * @param isManaged - Whether a widget edits the mapping at `ref` itself (`WidgetDefinition.managesKeys`); such a
 *   mapping is not an outline node, its parent's section shows the widget.
 * @param hiddenRootKey - A top-level key of a `mapping` format to leave out (the variables block, which has its own section).
 * @internal
 */
export function buildOutline(
  p: ParsedText,
  format: FormatDefinition,
  labelFor: (ref: NodeRef, key: string) => string,
  messages: UiMessages,
  isUnknown: (doc: number, apiVersion: string, kind: string) => boolean = () => false,
  isManaged: (ref: NodeRef) => boolean = () => false,
  hiddenRootKey?: string,
): readonly OutlineNode[] {
  const make = (ref: NodeRef, label: string, view: NodeView, data: unknown, depth: number): OutlineNode => {
    const readOnly: EditRefusal | undefined = view.type === 'alias' ? 'alias' : view.readOnly;
    const children: OutlineNode[] = [];
    if (depth < MAX_DEPTH && view.type === 'map') {
      for (const key of unique(view.keys ?? [])) {
        const childRef: NodeRef = { doc: ref.doc, path: [...ref.path, key] };
        const cv = describeNode(p, childRef);
        if (!cv || cv.type === 'scalar' || (cv.type === 'map' && isManaged(childRef))) continue;
        children.push(make(childRef, labelFor(childRef, key), cv, isRecord(data) ? data[key] : undefined, depth + 1));
      }
    } else if (depth < MAX_DEPTH && view.type === 'seq') {
      for (let i = 0; i < (view.length ?? 0); i++) {
        const childRef: NodeRef = { doc: ref.doc, path: [...ref.path, i] };
        const cv = describeNode(p, childRef);
        if (!cv || cv.type === 'scalar') continue;
        const item = Array.isArray(data) ? (data[i] as unknown) : undefined;
        const name = isRecord(item) && typeof item['name'] === 'string' ? item['name'] : undefined;
        children.push(make(childRef, name ?? `${messages.item} ${i + 1}`, cv, item, depth + 1));
      }
    }
    return {
      id: nodeId(ref),
      ref,
      label,
      type: view.type === 'seq' ? 'seq' : 'map',
      children,
      ...(readOnly ? { readOnly } : {}),
    };
  };

  const out: OutlineNode[] = [];
  if (format.rootModel === 'mapping') {
    if (p.docCount === 0 || isEmptyDocument(p, 0)) return out;
    const root = describeNode(p, { doc: 0, path: [] });
    if (root?.type !== 'map') return out;
    const data = safeData(p, 0);
    for (const key of unique(root.keys ?? [])) {
      if (key === hiddenRootKey) continue;
      const ref: NodeRef = { doc: 0, path: [key] };
      const view = describeNode(p, ref);
      if (!view || view.type === 'scalar' || (view.type === 'map' && isManaged(ref))) continue;
      out.push(make(ref, labelFor(ref, key), view, isRecord(data) ? data[key] : undefined, 1));
    }
    return out;
  }

  for (let doc = 0; doc < p.docCount; doc++) {
    if (isEmptyDocument(p, doc)) continue;
    const ref: NodeRef = { doc, path: [] };
    const view = describeNode(p, ref);
    if (!view) continue;
    const data = safeData(p, doc);
    const apiVersion = isRecord(data) ? data['apiVersion'] : undefined;
    const kind = isRecord(data) ? data['kind'] : undefined;
    const meta = isRecord(data) ? data['metadata'] : undefined;
    const name = isRecord(meta) && typeof meta['name'] === 'string' ? meta['name'] : undefined;
    const shaped = typeof apiVersion === 'string' && typeof kind === 'string';
    const base = shaped ? labelFor(ref, kind) : `${messages.document} ${doc + 1}`;
    const label = name !== undefined ? `${base} ${name}` : base;
    const unknown = shaped && isUnknown(doc, apiVersion, kind);
    // An unknown kind is a leaf: nothing below it is offered visually.
    const node = make(ref, label, unknown ? { ...view, type: 'scalar', value: null } : view, data, 0);
    out.push({ ...node, type: 'document', ...(unknown ? { unknownKind: true } : {}) });
  }
  return out;
}
