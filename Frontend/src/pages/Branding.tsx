import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PaletteIcon, UploadIcon, XIcon } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { notify } from '../components/ui/Toast';
import { apiRequest, endpoints, ApiError } from '../utils/api';
import { useUserFeatures } from '../utils/features';

interface BrandProfile {
  brandName: string;
  tagline: string;
  voice: string;
  toneGuidelines: string;
  colors: string[];
  logoUrl?: string | null;
}

const EMPTY: BrandProfile = { brandName: '', tagline: '', voice: '', toneGuidelines: '', colors: [] };

export function BrandingPage() {
  const navigate = useNavigate();
  const { loading: featuresLoading, features } = useUserFeatures();
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [profile, setProfile] = React.useState<BrandProfile>(EMPTY);
  const [colorInput, setColorInput] = React.useState('');

  const hasBranding = !featuresLoading && features['custom_branding'] === true;

  React.useEffect(() => {
    if (featuresLoading || features['custom_branding'] !== true) return;
    async function load() {
      try {
        const data = await apiRequest<{ profile: BrandProfile }>(endpoints.brandProfile);
        setProfile({ ...EMPTY, ...(data.profile || {}) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          notify.error('Feature not included', 'Custom branding is not part of your current package.');
        }
      }
    }
    load();
  }, [featuresLoading, features]);

  const save = async () => {
    setSaving(true);
    try {
      const data = await apiRequest<{ profile: BrandProfile }>(endpoints.brandProfile, {
        method: 'PUT',
        body: JSON.stringify({
          brandName: profile.brandName,
          tagline: profile.tagline,
          voice: profile.voice,
          toneGuidelines: profile.toneGuidelines,
          colors: profile.colors,
        }),
      });
      setProfile((p) => ({ ...p, ...(data.profile || {}) }));
      notify.success('Saved', 'Your brand identity has been updated.');
    } catch (err) {
      notify.error('Failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      notify.error('Invalid file', 'Please choose a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify.error('Too large', 'Logo must be smaller than 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setUploading(true);
      try {
        const data = await apiRequest<{ logoUrl: string }>(endpoints.brandLogo, {
          method: 'POST',
          body: JSON.stringify({ dataUrl }),
        });
        setProfile((p) => ({ ...p, logoUrl: data.logoUrl }));
        notify.success('Logo Uploaded', 'Your logo will appear on generated images.');
      } catch (err) {
        notify.error('Failed', (err as Error).message);
      } finally {
        setUploading(false);
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const addColor = () => {
    const c = colorInput.trim();
    if (!c) return;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
      notify.error('Invalid color', 'Use a hex color like #FF5733.');
      return;
    }
    setProfile((p) => ({ ...p, colors: [...p.colors, c].slice(0, 6) }));
    setColorInput('');
  };

  if (featuresLoading) {
    return (
      <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
        </div>
      </div>
    );
  }

  if (!hasBranding) {
    return (
      <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold mb-2">Custom Branding</h1>
          <p className="text-slate-500 mb-6">Make generated posts look and sound like your brand.</p>
          <Card className="text-center py-12">
            <div className="text-4xl mb-4">🎨</div>
            <h2 className="text-xl font-semibold mb-2">Feature Not Included</h2>
            <p className="text-slate-500 mb-6">
              Custom branding is not included in your current package. Upgrade to add your logo, colors and brand voice to every generated post.
            </p>
            <Button onClick={() => navigate('/packages')}>View Packages</Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold mb-2">Custom Branding</h1>
        <p className="text-slate-500 mb-6">Your brand identity is woven into every caption and your logo is stamped on generated images.</p>

        <div className="grid gap-6">
          <Card>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <PaletteIcon className="h-5 w-5 text-indigo-500" />
              Brand Logo
            </h3>
            <div className="flex flex-wrap items-center gap-4">
              {profile.logoUrl ? (
                <img src={profile.logoUrl} alt="Brand logo" className="h-20 w-20 rounded-xl border border-slate-200 object-contain dark:border-slate-700" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-300 dark:border-slate-700">
                  <UploadIcon className="h-6 w-6" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                  <UploadIcon className="h-4 w-4" />
                  {profile.logoUrl ? 'Replace logo' : 'Upload logo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogoFile} />
                </label>
                {profile.logoUrl && (
                  <Button variant="ghost" size="sm" onClick={() => setProfile((p) => ({ ...p, logoUrl: null }))}>
                    <XIcon className="h-4 w-4" />
                    Remove (keeps file)
                  </Button>
                )}
                {uploading && <p className="text-xs text-slate-500">Uploading logo...</p>}
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold mb-4">Brand Identity</h3>
            <div className="space-y-4">
              <Input
                label="Brand name"
                value={profile.brandName}
                onChange={(e) => setProfile((p) => ({ ...p, brandName: e.target.value }))}
                placeholder="e.g. Bakeology"
              />
              <Input
                label="Tagline"
                value={profile.tagline}
                onChange={(e) => setProfile((p) => ({ ...p, tagline: e.target.value }))}
                placeholder="e.g. Freshly baked, daily"
              />
              <Input
                label="Brand voice"
                value={profile.voice}
                onChange={(e) => setProfile((p) => ({ ...p, voice: e.target.value }))}
                placeholder="e.g. friendly, playful, luxury, professional"
              />
              <Textarea
                label="Tone guidelines"
                value={profile.toneGuidelines}
                onChange={(e) => setProfile((p) => ({ ...p, toneGuidelines: e.target.value }))}
                placeholder="How should the brand speak? Short sentences, no slang, always encouraging..."
                rows={3}
              />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Brand colors (max 6)</label>
                <div className="flex flex-wrap items-center gap-2">
                  {profile.colors.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs dark:border-slate-700">
                      <span className="h-3.5 w-3.5 rounded-full border border-slate-200" style={{ backgroundColor: c }} />
                      {c}
                      <button type="button" onClick={() => setProfile((p) => ({ ...p, colors: p.colors.filter((x) => x !== c) }))} aria-label={`Remove ${c}`}>
                        <XIcon className="h-3 w-3 text-slate-400 hover:text-red-500" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={colorInput}
                    onChange={(e) => setColorInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } }}
                    placeholder="#FF5733"
                    className="h-9 w-32 rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                  <Button variant="secondary" size="sm" onClick={addColor}>Add</Button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button onClick={save} loading={saving}>
                  Save Brand Identity
                </Button>
              </div>
            </div>
          </Card>

          <Card className="bg-indigo-50/50 dark:bg-indigo-500/5">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-semibold">How it works:</span> When custom branding is enabled, generated captions naturally reflect your brand name, voice and colors, and your logo is stamped on the bottom-right of generated images.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
