import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Package } from '../../model/package';
import { el, txt } from '../../xml/fragment';
import { parsePackage } from '../../package-io/read';
import { readOdbForm } from './form';

// Every assertion below is against src/typed/odb/fixtures/form-and-report.odb, a real, unmodified LibreOffice 26.2-generated .odb (see typed/odb/read.ts's own top-of-file note for how it was generated and cross-verified) -- the whole point of this reader is that its shape is grounded in genuine producer output rather than in the ODF form: schema read cold. A small number of synthetic, hand-built packages at the end cover error paths no real file produces.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

describe('readOdbForm: form-and-report.odb (real LibreOffice output)', () => {
  const form = readOdbForm(loadFixture('form-and-report.odb'), 'SalesForm');

  it('reports the form\'s user-visible name alongside the opaque persistent path its sub-document actually lives at', () => {
    expect(form.name).toBe('SalesForm');
    expect(form.href).toBe('forms/Obj11');
  });

  it('reads the sub-document as the ordinary ODF text document it genuinely is, through readOdtContent unmodified', () => {
    expect(form.document.sections).toHaveLength(1);
    expect(form.document.metadata).toBeDefined();
  });

  it('reads exactly one top-level form:form, bound to the SALES table', () => {
    expect(form.forms).toHaveLength(1);
    const [definition] = form.forms;
    expect(definition?.name).toBe('SalesForm');
    expect(definition?.command).toBe('SALES');
    expect(definition?.commandType).toBe('table');
  });

  it('reads every bound control with its real element tag, UNO control implementation, and form:data-field binding', () => {
    expect(form.forms[0]?.controls).toEqual([
      {
        tag: 'form:fixed-text',
        controls: [],
        name: 'lblHeading',
        controlImplementation: 'ooo:com.sun.star.form.component.FixedText',
        id: 'control1',
        label: 'Customer record',
      },
      { tag: 'form:text', controls: [], name: 'txtCustomer', controlImplementation: 'ooo:com.sun.star.form.component.TextField', dataField: 'CUSTOMER', id: 'control2' },
      { tag: 'form:text', controls: [], name: 'txtRegion', controlImplementation: 'ooo:com.sun.star.form.component.TextField', dataField: 'REGION', id: 'control3' },
      { tag: 'form:listbox', controls: [], name: 'lstQuarter', controlImplementation: 'ooo:com.sun.star.form.component.ListBox', dataField: 'QUARTER', id: 'control4' },
      { tag: 'form:formatted-text', controls: [], name: 'numAmount', controlImplementation: 'ooo:com.sun.star.form.component.NumericField', dataField: 'AMOUNT', id: 'control5' },
    ]);
  });

  it('reads a static label control\'s own form:label, and never invents a dataField for it', () => {
    const label = form.forms[0]?.controls[0];
    expect(label?.label).toBe('Customer record');
    expect('dataField' in (label ?? {})).toBe(false);
  });

  it('reads a nested form:form as a real sub-form with its OWN command binding, not as a control of its parent', () => {
    expect(form.forms[0]?.subForms).toEqual([
      {
        controls: [
          { tag: 'form:text', controls: [], name: 'txtSubCustomer', controlImplementation: 'ooo:com.sun.star.form.component.TextField', dataField: 'CUSTOMER', id: 'control6' },
        ],
        subForms: [],
        name: 'HighValueSubForm',
        command: 'HighValueSales',
        commandType: 'query',
      },
    ]);
  });

  it('proves the sub-form genuinely binds differently from its parent -- a QUERY nested inside a TABLE-bound form', () => {
    expect(form.forms[0]?.commandType).toBe('table');
    expect(form.forms[0]?.subForms[0]?.commandType).toBe('query');
  });

  it('never surfaces form:properties -- a producer-specific UNO property bag, not form structure', () => {
    const tags = form.forms[0]?.controls.map((control) => control.tag) ?? [];
    expect(tags).not.toContain('form:properties');
  });
});

describe('readOdbForm: synthetic control-tree shapes', () => {
  function formPackage(formsChildren: ReturnType<typeof el>[]): Package {
    return {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [
            el('office:document-content', {}, [
              el('office:body', {}, [
                el('office:database', {}, [el('db:forms', {}, [el('db:component', { 'db:name': 'F', 'xlink:href': 'forms/Obj1' })])]),
              ]),
            ]),
          ],
        },
        'forms/Obj1/content.xml': {
          kind: 'xml',
          nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [el('office:forms', {}, formsChildren)])])])],
        },
      },
    };
  }

  it('reads a form:grid\'s own form:column children as ordinary nested controls rather than dropping them', () => {
    const pkg = formPackage([
      el('form:form', { 'form:name': 'Main' }, [
        el('form:grid', { 'form:name': 'grid1', 'form:id': 'c1' }, [
          el('form:column', { 'form:name': 'colA', 'form:data-field': 'A' }),
          el('form:column', { 'form:name': 'colB', 'form:data-field': 'B' }),
        ]),
      ]),
    ]);
    expect(readOdbForm(pkg, 'F').forms[0]?.controls).toEqual([
      {
        tag: 'form:grid',
        name: 'grid1',
        id: 'c1',
        controls: [
          { tag: 'form:column', controls: [], name: 'colA', dataField: 'A' },
          { tag: 'form:column', controls: [], name: 'colB', dataField: 'B' },
        ],
      },
    ]);
  });

  it('reads several top-level form:form siblings, in document order', () => {
    const pkg = formPackage([el('form:form', { 'form:name': 'One' }), el('form:form', { 'form:name': 'Two' })]);
    expect(readOdbForm(pkg, 'F').forms.map((definition) => definition.name)).toEqual(['One', 'Two']);
  });

  it('reads a form:filter and form:order when the form declares them', () => {
    const pkg = formPackage([el('form:form', { 'form:name': 'Filtered', 'form:filter': '"AMOUNT" > 100', 'form:order': '"REGION" ASC', 'form:datasource': 'SalesDb' })]);
    const definition = readOdbForm(pkg, 'F').forms[0];
    expect(definition?.filter).toBe('"AMOUNT" > 100');
    expect(definition?.order).toBe('"REGION" ASC');
    expect(definition?.datasource).toBe('SalesDb');
  });

  it('degrades to an empty forms array when office:text carries no office:forms at all, since the text content is still perfectly readable', () => {
    const pkg: Package = {
      parts: {
        'content.xml': {
          kind: 'xml',
          nodes: [
            el('office:document-content', {}, [
              el('office:body', {}, [
                el('office:database', {}, [el('db:forms', {}, [el('db:component', { 'db:name': 'F', 'xlink:href': 'forms/Obj1' })])]),
              ]),
            ]),
          ],
        },
        'forms/Obj1/content.xml': {
          kind: 'xml',
          nodes: [el('office:document-content', {}, [el('office:body', {}, [el('office:text', {}, [el('text:p', {}, [txt('plain text, no controls')])])])])],
        },
      },
    };
    const form = readOdbForm(pkg, 'F');
    expect(form.forms).toEqual([]);
    expect(form.document.sections).toHaveLength(1);
  });
});

describe('readOdbForm: error paths', () => {
  const baseContent = {
    kind: 'xml' as const,
    nodes: [
      el('office:document-content', {}, [
        el('office:body', {}, [el('office:database', {}, [el('db:forms', {}, [el('db:component', { 'db:name': 'F', 'xlink:href': 'forms/Obj1' })])])]),
      ]),
    ],
  };

  it('throws when the .odb declares no form by that name', () => {
    expect(() => readOdbForm({ parts: { 'content.xml': baseContent } }, 'Missing')).toThrow(/no form named "Missing"/);
  });

  it('throws when the declared sub-document is absent from the package', () => {
    expect(() => readOdbForm({ parts: { 'content.xml': baseContent } }, 'F')).toThrow(/forms\/Obj1\/content\.xml/);
  });

  it('throws when the sub-document\'s content.xml is a binary part rather than XML', () => {
    const pkg: Package = { parts: { 'content.xml': baseContent, 'forms/Obj1/content.xml': { kind: 'binary', base64: '' } } };
    expect(() => readOdbForm(pkg, 'F')).toThrow(/forms\/Obj1\/content\.xml/);
  });
});
