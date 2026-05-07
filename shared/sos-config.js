const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_CONTACT_NAME = '社区值班中心';

function normalizePhone(phone) {
  if (phone === undefined || phone === null) {
    return '';
  }

  return String(phone).trim().replace(/\s+/g, '');
}

function isValidPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return false;
  }

  return /^[+]?[0-9][0-9\-()]{5,}[0-9]$/.test(normalized);
}

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function getValue(source, keys, fallback) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source || {}, key) && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return fallback;
}

function getEnvDefaults(env = process.env) {
  const defaultContactName = String(getValue(env, ['SOS_DEFAULT_CONTACT', 'SOS_DEFAULT_CONTACT_NAME'], DEFAULT_CONTACT_NAME)).trim() || DEFAULT_CONTACT_NAME;
  const defaultPhone = normalizePhone(getValue(env, ['SOS_DEFAULT_PHONE', 'SOS_PHONE'], ''));

  return {
    defaultContactName,
    defaultPhone,
    dialEnabled: parseBoolean(getValue(env, ['SOS_DIAL_ENABLED'], true), true),
    note: String(getValue(env, ['SOS_NOTE'], '')).trim(),
    createdAt: null,
    updatedAt: null,
    updatedById: null,
    updatedByName: '',
    updatedByRole: '',
    source: 'env',
    configPath: null,
    loadError: null
  };
}

function getSosConfigPath(configPath) {
  const resolvedPath = configPath || process.env.SOS_CONFIG_PATH || path.resolve(__dirname, 'sos-config.json');
  return path.isAbsolute(resolvedPath) ? resolvedPath : path.resolve(process.cwd(), resolvedPath);
}

function normalizeStoredConfig(rawConfig, env = process.env) {
  const defaults = getEnvDefaults(env);

  return {
    ...defaults,
    defaultContactName: String(getValue(rawConfig, ['defaultContactName', 'default_contact_name'], defaults.defaultContactName)).trim() || defaults.defaultContactName,
    defaultPhone: normalizePhone(getValue(rawConfig, ['defaultPhone', 'default_phone'], defaults.defaultPhone)),
    dialEnabled: parseBoolean(getValue(rawConfig, ['dialEnabled', 'dial_enabled'], defaults.dialEnabled), defaults.dialEnabled),
    note: String(getValue(rawConfig, ['note'], defaults.note)).trim(),
    createdAt: getValue(rawConfig, ['createdAt', 'created_at'], defaults.createdAt),
    updatedAt: getValue(rawConfig, ['updatedAt', 'updated_at'], defaults.updatedAt),
    updatedById: getValue(rawConfig, ['updatedById', 'updated_by_id'], defaults.updatedById),
    updatedByName: String(getValue(rawConfig, ['updatedByName', 'updated_by_name'], defaults.updatedByName) || '').trim(),
    updatedByRole: String(getValue(rawConfig, ['updatedByRole', 'updated_by_role'], defaults.updatedByRole) || '').trim(),
    source: 'file',
    loadError: null,
    configPath: rawConfig?.configPath || null
  }
}

function validateSosConfig(input, env = process.env) {
  const defaults = getEnvDefaults(env);
  const defaultContactName = String(getValue(input, ['defaultContactName', 'default_contact_name'], defaults.defaultContactName)).trim();
  const defaultPhone = normalizePhone(getValue(input, ['defaultPhone', 'default_phone'], defaults.defaultPhone));
  const dialEnabled = parseBoolean(getValue(input, ['dialEnabled', 'dial_enabled'], defaults.dialEnabled), defaults.dialEnabled);
  const note = String(getValue(input, ['note'], defaults.note)).trim();

  if (!defaultContactName) {
    throw new Error('请输入 SOS 联系人名称');
  }

  if (!defaultPhone || !isValidPhone(defaultPhone)) {
    throw new Error('手机号格式不正确');
  }

  return {
    defaultContactName,
    defaultPhone,
    dialEnabled,
    note
  };
}

async function readSosConfig({ configPath, env = process.env } = {}) {
  const resolvedPath = getSosConfigPath(configPath);
  try {
    const content = await fs.readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(content);
    return {
      ...normalizeStoredConfig({ ...parsed, configPath: resolvedPath }, env),
      configPath: resolvedPath
    };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      const fallback = getEnvDefaults(env);
      return {
        ...fallback,
        source: 'env',
        configPath: resolvedPath,
        loadError: `读取 SOS 配置失败：${error.message}`
      };
    }

    const fallback = getEnvDefaults(env);
    return {
      ...fallback,
      configPath: resolvedPath
    };
  }
}

async function saveSosConfig(input, { configPath, env = process.env, operator = {} } = {}) {
  const resolvedPath = getSosConfigPath(configPath);
  const currentConfig = await readSosConfig({ configPath: resolvedPath, env });
  const mergedInput = {
    defaultContactName: getValue(input, ['defaultContactName', 'default_contact_name'], currentConfig.defaultContactName),
    defaultPhone: getValue(input, ['defaultPhone', 'default_phone'], currentConfig.defaultPhone),
    dialEnabled: getValue(input, ['dialEnabled', 'dial_enabled'], currentConfig.dialEnabled),
    note: getValue(input, ['note'], currentConfig.note)
  };
  const validated = validateSosConfig(mergedInput, env);
  const now = new Date().toISOString();

  const nextConfig = {
    defaultContactName: validated.defaultContactName,
    defaultPhone: validated.defaultPhone,
    dialEnabled: validated.dialEnabled,
    note: validated.note,
    createdAt: currentConfig.createdAt || now,
    updatedAt: now,
    updatedById: operator.id ?? null,
    updatedByName: operator.username || '',
    updatedByRole: operator.role || '',
    source: 'file',
    configPath: resolvedPath,
    loadError: null
  };

  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');

  return nextConfig;
}

function resolveSosTarget({ user, familyContacts = [], config, env = process.env } = {}) {
  const effectiveConfig = config || getEnvDefaults(env);
  const candidates = [];

  if (user) {
    candidates.push({
      contact_name: String(user.emergency_contact || user.real_name || user.username || '').trim(),
      phone: normalizePhone(user.emergency_phone),
      source: 'user',
      user_id: user.id || null
    });
  }

  for (const familyContact of familyContacts) {
    candidates.push({
      contact_name: String(familyContact.contact_name || familyContact.real_name || familyContact.username || '家属联系人').trim(),
      phone: normalizePhone(familyContact.phone),
      source: 'family',
      user_id: familyContact.user_id || familyContact.id || null
    });
  }

  candidates.push({
    contact_name: String(effectiveConfig.defaultContactName || DEFAULT_CONTACT_NAME).trim() || DEFAULT_CONTACT_NAME,
    phone: normalizePhone(effectiveConfig.defaultPhone),
    source: 'system',
    user_id: null
  });

  const matched = candidates.find((candidate) => isValidPhone(candidate.phone));
  const selected = matched || candidates[candidates.length - 1];

  return {
    contact_name: selected.contact_name,
    phone: selected.phone,
    source: selected.source,
    dial_enabled: Boolean(effectiveConfig.dialEnabled),
    user_id: selected.user_id || null
  };
}

module.exports = {
  DEFAULT_CONTACT_NAME,
  normalizePhone,
  isValidPhone,
  parseBoolean,
  getEnvDefaults,
  getSosConfigPath,
  readSosConfig,
  saveSosConfig,
  validateSosConfig,
  resolveSosTarget,
  normalizeStoredConfig
};