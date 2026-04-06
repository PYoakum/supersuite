export interface Theme {
  '--color-primary': string;
  '--color-primary-hover': string;
  '--color-bg': string;
  '--color-bg-secondary': string;
  '--color-border': string;
  '--color-text': string;
  '--color-text-secondary': string;
  '--color-danger': string;
  '--color-success': string;
  '--color-warning': string;
}

const themes: Record<string, Theme> = {
  default: {
    '--color-primary': '#3B82F6',
    '--color-primary-hover': '#2563EB',
    '--color-bg': '#FFFFFF',
    '--color-bg-secondary': '#F9FAFB',
    '--color-border': '#E5E7EB',
    '--color-text': '#111827',
    '--color-text-secondary': '#6B7280',
    '--color-danger': '#EF4444',
    '--color-success': '#10B981',
    '--color-warning': '#F59E0B',
  },
  dark: {
    '--color-primary': '#60A5FA',
    '--color-primary-hover': '#3B82F6',
    '--color-bg': '#111827',
    '--color-bg-secondary': '#1F2937',
    '--color-border': '#374151',
    '--color-text': '#F9FAFB',
    '--color-text-secondary': '#9CA3AF',
    '--color-danger': '#F87171',
    '--color-success': '#34D399',
    '--color-warning': '#FBBF24',
  },
  nord: {
    '--color-primary': '#88C0D0',
    '--color-primary-hover': '#81A1C1',
    '--color-bg': '#2E3440',
    '--color-bg-secondary': '#3B4252',
    '--color-border': '#4C566A',
    '--color-text': '#ECEFF4',
    '--color-text-secondary': '#D8DEE9',
    '--color-danger': '#BF616A',
    '--color-success': '#A3BE8C',
    '--color-warning': '#EBCB8B',
  },
  rose: {
    '--color-primary': '#F43F5E',
    '--color-primary-hover': '#E11D48',
    '--color-bg': '#FFF1F2',
    '--color-bg-secondary': '#FFE4E6',
    '--color-border': '#FECDD3',
    '--color-text': '#1F2937',
    '--color-text-secondary': '#6B7280',
    '--color-danger': '#DC2626',
    '--color-success': '#059669',
    '--color-warning': '#D97706',
  },
  forest: {
    '--color-primary': '#059669',
    '--color-primary-hover': '#047857',
    '--color-bg': '#F0FDF4',
    '--color-bg-secondary': '#DCFCE7',
    '--color-border': '#BBF7D0',
    '--color-text': '#14532D',
    '--color-text-secondary': '#3F6212',
    '--color-danger': '#DC2626',
    '--color-success': '#16A34A',
    '--color-warning': '#CA8A04',
  },
  synthwave: {
    '--color-primary': '#FF2975',
    '--color-primary-hover': '#FF6AC1',
    '--color-bg': '#1A1033',
    '--color-bg-secondary': '#241B3A',
    '--color-border': '#392E5C',
    '--color-text': '#F0E6FF',
    '--color-text-secondary': '#B4A0D6',
    '--color-danger': '#FF3864',
    '--color-success': '#72F1B8',
    '--color-warning': '#FEDE5D',
  },
  midnight: {
    '--color-primary': '#A78BFA',
    '--color-primary-hover': '#8B5CF6',
    '--color-bg': '#0F0A1A',
    '--color-bg-secondary': '#1A1429',
    '--color-border': '#2D2640',
    '--color-text': '#E8E0F0',
    '--color-text-secondary': '#A09CB0',
    '--color-danger': '#FB7185',
    '--color-success': '#4ADE80',
    '--color-warning': '#FCD34D',
  },
};

export function applyTheme(name: string) {
  const theme = themes[name] || themes.default;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme)) {
    root.style.setProperty(prop, value);
  }
}

export function getThemeFromQuery(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('theme') || 'default';
}

export const themeNames = Object.keys(themes);
