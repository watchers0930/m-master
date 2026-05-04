type InputFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password" | "url";
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
};

export function InputField({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  multiline = false,
  rows = 4,
}: InputFieldProps) {
  return (
    <div className="field-group">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="text-area"
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type={type}
          className="text-input"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? <p className="fine-print">{hint}</p> : null}
    </div>
  );
}
