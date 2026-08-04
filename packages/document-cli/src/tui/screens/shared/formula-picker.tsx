import { Box, Text } from 'ink';
import { useState, type ReactElement } from 'react';
import { parseXml, type MathMlNode } from 'documents.js';
import { ListView } from '../../components/list-view.js';
import { TextField } from '../../components/text-field.js';
import { useNavigationInput } from '../../keybindings/use-navigation-input.js';
import { describeError } from '../../errors.js';
import { FORMULA_PRESETS } from './formula-presets.js';

const RAW_ENTRY_LABEL = 'Raw MathML...';

interface PickerRow {
  readonly label: string;
  // undefined marks the one "raw MathML" row, distinguishing it from every real preset row without a second discriminant field.
  readonly mathml: readonly MathMlNode[] | undefined;
}

const PICKER_ROWS: readonly PickerRow[] = [...FORMULA_PRESETS.map((preset) => ({ label: preset.label, mathml: preset.mathml })), { label: RAW_ENTRY_LABEL, mathml: undefined }];

export interface FormulaPickerProps {
  readonly isActive: boolean;
  readonly onCancel: () => void;
  // Fires with the chosen mathml -- either a preset's own tree, or a raw entry successfully parsed by parseXml. The caller decides what to do with it (dispatch immediately for docx's paragraph-scoped formula, or stash it and prompt for a frame next for odt's body-scoped one) -- this component never dispatches anything itself.
  readonly onMathml: (mathml: readonly MathMlNode[]) => void;
  readonly onInvalidRawMathml: (message: string) => void;
}

// A preset picker (the fast default path) plus a raw-MathML free-text entry (the advanced fallback, wrapping the typed string in documents.js's own parseXml -- structurally compatible with MathMlNode[] with zero cast, see mathml/nodes.ts's own doc comment). Shared between paragraph-detail.tsx (docx, paragraph-scoped) and paragraph-family.tsx's ParagraphFamilyBodyList (odt, body-scoped, followed by a frame wizard) -- the picking UI is identical either way; only what happens with the result differs.
export function FormulaPicker(props: FormulaPickerProps): ReactElement {
  const [rawInput, setRawInput] = useState<string | undefined>(undefined);

  const { selectedIndex } = useNavigationInput({
    itemCount: PICKER_ROWS.length,
    isActive: props.isActive && rawInput === undefined,
    onBack: props.onCancel,
    onSelect: (index) => {
      const row = PICKER_ROWS[index];
      if (row === undefined) {
        return;
      }
      if (row.mathml === undefined) {
        setRawInput('');
        return;
      }
      props.onMathml(row.mathml);
    },
  });

  if (rawInput !== undefined) {
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>Raw MathML (the children of the &lt;math&gt; root, e.g. &lt;mfrac&gt;...&lt;/mfrac&gt;)</Text>
        <TextField
          value={rawInput}
          isFocused
          onChange={setRawInput}
          onCancel={() => {
            setRawInput(undefined);
          }}
          onSubmit={(value) => {
            try {
              const parsed = parseXml(value);
              props.onMathml(parsed);
            } catch (error) {
              props.onInvalidRawMathml(describeError(error));
            }
            setRawInput(undefined);
          }}
        />
        <Text dimColor>Enter to insert, Esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>Insert formula -- choose a preset or write raw MathML</Text>
      <ListView
        items={PICKER_ROWS}
        selectedIndex={selectedIndex}
        reservedRows={PICKER_ROWS.length + 2}
        renderItem={(row, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined}>
            {isSelected ? '> ' : '  '}
            {row.label}
          </Text>
        )}
      />
      <Text dimColor>Enter to choose, Esc to cancel</Text>
    </Box>
  );
}
