import { describe, expect, it } from 'vitest';
import type { LayoutFormField } from './layout';
import { readPdf } from './read';
import { acroFormPdf, minimalClassicXrefPdf } from './test-support/pdf';

// AcroForm (#721 phase 5): the /Fields recursion with fully-qualified names (/T chains joined with '.'), /FT per type, /V values, /Ff flags (ReadOnly, the combo and radio bits), choice /Opt, and the merged-field/widget split -- a terminal field's /Kids are widget annotations placed by their /P page, while a field carrying its own /Rect is its own single merged widget. Signature fields read as facts only; certification binds to bytes a semantic pivot never reproduces, so the residue-side treatment lives with the consumer.

// Depth-first search: group children live nested, so a name lookup has to descend the tree rather than scanning the root list.
function findField(fields: readonly LayoutFormField[] | undefined, name: string): LayoutFormField | undefined {
  for (const field of fields ?? []) {
    if (field.name === name) {
      return field;
    }
    const nested = findField(field.children, name);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

describe('readPdf: AcroForm fields', () => {
  it('reads a merged text field with value, alias, and the ReadOnly flag', () => {
    const doc = readPdf(acroFormPdf());
    const field = doc.form?.find((f) => f.name === 'fullname');
    expect(field).toEqual({
      name: 'fullname',
      fieldType: 'text',
      value: 'Jane Doe',
      alias: 'Full name',
      readOnly: true,
      widgets: [{ pageIndex: 0, xPt: 10, yPt: 80, widthPt: 100, heightPt: 16 }],
      children: [],
    });
  });

  it('reads a non-terminal field as a group whose children carry fully-qualified names', () => {
    const doc = readPdf(acroFormPdf());
    const contact = doc.form?.find((f) => f.name === 'contact');
    expect(contact).toMatchObject({ name: 'contact', fieldType: 'group', widgets: [] });
    expect(contact?.children.map((c) => c.name)).toEqual(['contact.country', 'contact.subscribe']);
  });

  it('maps /FT /Ch with the combo flag to comboBox and reads /Opt choices and /V', () => {
    const doc = readPdf(acroFormPdf());
    const combo = findField(doc.form, 'contact.country');
    expect(combo).toMatchObject({ fieldType: 'combobox', value: 'UK', options: ['UK', 'US'] });
    expect(combo?.widgets).toEqual([{ pageIndex: 0, xPt: 10, yPt: 60, widthPt: 100, heightPt: 14 }]);
  });

  it('maps /FT /Btn to checkbox with the checked state derived from /V', () => {
    const doc = readPdf(acroFormPdf());
    const checkbox = findField(doc.form, 'contact.subscribe');
    expect(checkbox).toMatchObject({ fieldType: 'checkbox', checked: true, value: 'Yes' });
  });

  it('maps /FT /Sig to a signature field with no control value', () => {
    const doc = readPdf(acroFormPdf());
    const signature = findField(doc.form, 'sig');
    expect(signature).toMatchObject({ fieldType: 'signature' });
    expect(signature?.value).toBeUndefined();
    expect(signature?.checked).toBeUndefined();
  });

  it('collects the root field list in document order', () => {
    const doc = readPdf(acroFormPdf());
    expect(doc.form?.map((f) => f.name)).toEqual(['fullname', 'contact', 'sig']);
  });

  it('leaves form absent for a document without /AcroForm', () => {
    const doc = readPdf(minimalClassicXrefPdf());
    expect(doc.form).toBeUndefined();
  });
});
