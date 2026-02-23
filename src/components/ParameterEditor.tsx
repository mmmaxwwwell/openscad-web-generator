import { useCallback } from 'react';
import type { ScadParam, ScadValue } from '../types';

interface ParameterEditorProps {
  params: ScadParam[];
  values: Record<string, ScadValue>;
  onChange: (name: string, value: ScadValue) => void;
}

export function ParameterEditor({ params, values, onChange }: ParameterEditorProps) {
  if (params.length === 0) {
    return <div className="param-editor-empty">No parameters defined in this file.</div>;
  }

  return (
    <div className="param-editor">
      <h3>Parameters</h3>
      <div className="param-list">
        {params.map((param) => (
          <ParamField
            key={param.name}
            param={param}
            value={values[param.name] ?? param.default}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

interface ParamFieldProps {
  param: ScadParam;
  value: ScadValue;
  onChange: (name: string, value: ScadValue) => void;
}

function ParamField({ param, value, onChange }: ParamFieldProps) {
  const handleChange = useCallback(
    (newValue: ScadValue) => onChange(param.name, newValue),
    [param.name, onChange],
  );

  return (
    <div className="param-field">
      <label className="param-label">
        <span className="param-name">{param.name}</span>
        {param.help && <span className="param-help">{param.help}</span>}
      </label>
      <div className="param-input">
        {param.type === 'boolean' ? (
          <BooleanInput value={value as boolean} onChange={handleChange} />
        ) : param.type === 'enum' ? (
          <EnumInput value={value as string} options={param.options!} onChange={handleChange} />
        ) : param.type === 'vector' ? (
          <VectorInput value={value as number[]} onChange={handleChange} />
        ) : param.type === 'number' ? (
          <NumberInput value={value as number} onChange={handleChange} />
        ) : (
          <StringInput value={value as string} onChange={handleChange} />
        )}
      </div>
    </div>
  );
}

function BooleanInput({ value, onChange }: { value: boolean; onChange: (v: ScadValue) => void }) {
  return (
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

function EnumInput({ value, options, onChange }: { value: string; options: string[]; onChange: (v: ScadValue) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: ScadValue) => void }) {
  return (
    <input
      type="number"
      value={value}
      step="any"
      onChange={(e) => {
        const num = parseFloat(e.target.value);
        if (!isNaN(num)) onChange(num);
      }}
    />
  );
}

function StringInput({ value, onChange }: { value: string; onChange: (v: ScadValue) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function VectorInput({ value, onChange }: { value: number[]; onChange: (v: ScadValue) => void }) {
  const handleElementChange = useCallback(
    (index: number, num: number) => {
      const newVec = [...value];
      newVec[index] = num;
      onChange(newVec);
    },
    [value, onChange],
  );

  return (
    <div className="vector-input">
      {value.map((v, i) => (
        <input
          key={i}
          type="number"
          value={v}
          step="any"
          onChange={(e) => {
            const num = parseFloat(e.target.value);
            if (!isNaN(num)) handleElementChange(i, num);
          }}
        />
      ))}
    </div>
  );
}
