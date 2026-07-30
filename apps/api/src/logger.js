function serialize(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
}

function write(level, fields, message) {
  const entry = {
    level,
    time: new Date().toISOString(),
    message: message ?? String(fields ?? ''),
    ...(fields && typeof fields === 'object' ? serialize(fields) : {}),
  };
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = Object.freeze({
  info: (fields, message) => write('info', fields, message),
  warn: (fields, message) => write('warn', fields, message),
  error: (fields, message) => write('error', fields, message),
});
