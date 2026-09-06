'use client';

import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { Eye, EyeOff, Loader2, Save, Sparkles, MessageCircle, Plus, ScanEye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { toast } from 'sonner';
import { useProject } from '@/components/projects/project-provider';
import { PROVIDER_META, ProviderIcon } from '@/components/ui/provider-icon';
import { ProjectFormDialog } from '@/components/projects/project-form-dialog';

import { CustomModelModal } from '@/components/configure/custom-model-modal';
import { ModelCombobox } from './model-combobox';
import type { RagConfig, CustomModelConfig, EmbeddingModelDescriptor } from '@larkup/core/types';
import { EMBEDDING_DIMENSIONS } from '@larkup/core/embeddings/registry';

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<{ config: RagConfig }>);

const EMBEDDING_PROVIDER_LIST = [
  'vercel_ai_gateway',
  'openai',
  'google',
  'deepseek',
  'mistral',
  'cohere',
] as const;

const CHAT_PROVIDER_LIST = [
  'vercel_ai_gateway',
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'mistral',
  'cohere',
] as const;

const VISION_PROVIDER_LIST = new Set([
  'vercel_ai_gateway',
  'openai',
  'anthropic',
  'google',
  'mistral',
  'cohere',
  'deepseek',
]);

export function ModelsSection() {
  const { activeProject } = useProject();
  const serverId = activeProject?.id;

  const configUrl = serverId
    ? `/api/config?serverId=${encodeURIComponent(serverId)}`
    : '/api/config';
  const { data, isLoading, mutate } = useSWR(configUrl, fetcher);

  const { data: toolsData } = useSWR('/api/marketplace', (url: string) =>
    fetch(url).then((r) => r.json()),
  );

  const [form, setForm] = useState<Partial<RagConfig>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showEmbeddingKey, setShowEmbeddingKey] = useState(false);
  const [showChatKey, setShowChatKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);
  const [showToolKeys, setShowToolKeys] = useState<Record<string, boolean>>({});

  const currentChatProvider = form.chatProvider || form.embeddingProvider || 'openai';
  const statusKey = serverId
    ? `/api/chat/status?serverId=${encodeURIComponent(serverId)}&provider=${currentChatProvider}`
    : `/api/chat/status?provider=${currentChatProvider}`;
  const { data: chatStatus } = useSWR(statusKey, (url: string) => fetch(url).then((r) => r.json()));

  const embeddingModels: EmbeddingModelDescriptor[] = chatStatus?.availableEmbeddingModels ?? [];
  const visionModels: Array<{ id: string; label: string; provider: string }> =
    chatStatus?.availableVisionModels ?? [];
  const visionProviders = useMemo(() => {
    const providers = new Set(visionModels.map((model) => model.provider));
    if (visionModels.length > 0) {
      providers.add('vercel_ai_gateway');
    }
    return [...providers].filter(
      (provider) =>
        VISION_PROVIDER_LIST.has(provider) && PROVIDER_META[provider as keyof typeof PROVIDER_META],
    );
  }, [visionModels]);
  const EMBEDDING_BY_PROVIDER = useMemo(() => {
    return embeddingModels.reduce<Record<string, EmbeddingModelDescriptor[]>>((acc, m) => {
      (acc[m.provider] ??= []).push(m);
      return acc;
    }, {});
  }, [embeddingModels]);

  const { data: indexData } = useSWR('/api/index', (url: string) =>
    fetch(url).then((r) => r.json()),
  );
  const indexedRun = indexData?.run?.status === 'completed' ? indexData.run : null;

  const [newServerModalOpen, setNewServerModalOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [customEmbeddingModalOpen, setCustomEmbeddingModalOpen] = useState(false);
  const [customChatModalOpen, setCustomChatModalOpen] = useState(false);
  const [customVisionModalOpen, setCustomVisionModalOpen] = useState(false);
  const [isOtherEmbedding, setIsOtherEmbedding] = useState(false);
  const [isOtherChat, setIsOtherChat] = useState(false);
  const [isOtherVision, setIsOtherVision] = useState(false);

  useEffect(() => {
    if (data?.config) {
      setForm({
        ...data.config,
        chatProvider: data.config.chatProvider || data.config.embeddingProvider,
        chatApiKey: data.config.chatApiKey || data.config.embeddingApiKey,
        visionProvider:
          data.config.visionProvider || data.config.chatProvider || data.config.embeddingProvider,
        visionApiKey:
          data.config.visionApiKey || data.config.chatApiKey || data.config.embeddingApiKey,
        toolConfigs: data.config.toolConfigs || {},
      });
    }
  }, [data]);

  const dirtyEmbedding =
    form.embeddingProvider !== data?.config?.embeddingProvider ||
    form.embeddingModelId !== data?.config?.embeddingModelId ||
    form.embeddingApiKey !== data?.config?.embeddingApiKey ||
    JSON.stringify(form.customEmbeddings) !== JSON.stringify(data?.config?.customEmbeddings);

  const dirtyChat =
    form.chatProvider !== (data?.config?.chatProvider || data?.config?.embeddingProvider) ||
    form.chatModelId !== data?.config?.chatModelId ||
    form.chatApiKey !== (data?.config?.chatApiKey || data?.config?.embeddingApiKey) ||
    JSON.stringify(form.customChatModels) !== JSON.stringify(data?.config?.customChatModels);
  const savedVisionProvider =
    data?.config?.visionProvider || data?.config?.chatProvider || data?.config?.embeddingProvider;
  const savedVisionApiKey =
    data?.config?.visionApiKey || data?.config?.chatApiKey || data?.config?.embeddingApiKey;
  const dirtyVision =
    form.visionProvider !== savedVisionProvider ||
    form.visionModelId !== (data?.config?.visionModelId || '') ||
    form.visionApiKey !== savedVisionApiKey ||
    JSON.stringify(form.customVisionModels) !== JSON.stringify(data?.config?.customVisionModels);

  const clearError = (key: string) => {
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  function getEmbeddingDimensions(modelId: string | undefined): number | undefined {
    if (!modelId) return undefined;
    return (
      embeddingModels.find((model) => model.id === modelId)?.dimensions ??
      form.customEmbeddings?.find((model) => `custom:${model.modelName}` === modelId)?.dimensions ??
      EMBEDDING_DIMENSIONS[modelId]?.dimensions
    );
  }

  function canUseEmbeddingModel(modelId: string | undefined, knownDimensions?: number): boolean {
    if (!indexedRun) return true;
    const dimensions = knownDimensions ?? getEmbeddingDimensions(modelId);
    if (dimensions === indexedRun.dimensions) return true;

    toast.error('This embedding model is not compatible with the current index', {
      description:
        dimensions === undefined
          ? `The current index uses ${indexedRun.dimensions} dimensions. Choose a model with the same dimension or create a new project.`
          : `The current index uses ${indexedRun.dimensions} dimensions, but this model uses ${dimensions}. Create a new project to use it.`,
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: 'New Project',
        onClick: () => setNewServerModalOpen(true),
      },
    });
    return false;
  }

  async function handleSave(section: string) {
    if (!data?.config) return;

    let hasError = false;
    const newErrors: Record<string, string> = {};

    if (section === 'embedding') {
      if (!form.embeddingProvider) {
        newErrors.embeddingProvider = 'Required';
        hasError = true;
      }
      if (!form.embeddingApiKey) {
        newErrors.embeddingApiKey = 'Required';
        hasError = true;
      }
      if (!form.embeddingModelId) {
        newErrors.embeddingModelId = 'Required';
        hasError = true;
      } else if (!canUseEmbeddingModel(form.embeddingModelId)) {
        return;
      }
    } else if (section === 'chat') {
      if (!form.chatProvider) {
        newErrors.chatProvider = 'Required';
        hasError = true;
      }
      if (!form.chatApiKey) {
        newErrors.chatApiKey = 'Required';
        hasError = true;
      }
    } else if (section === 'vision') {
      if (!form.visionProvider) {
        newErrors.visionProvider = 'Required';
        hasError = true;
      }
      if (!form.visionApiKey) {
        newErrors.visionApiKey = 'Required';
        hasError = true;
      }
    } else if (section.startsWith('tool:')) {
      const toolId = section.split(':')[1];
      const tool = toolsData?.tools?.find((t: any) => t.id === toolId);
      if (tool?.configSchema) {
        for (const schema of tool.configSchema) {
          if (
            !form.toolConfigs?.[toolId]?.[schema.key] &&
            schema.type !== 'password' &&
            schema.type !== 'text'
          ) {
            // For passwords we allow empty since it could be optional or fallback
            // You can add stricter validation if schema.required was added to manifest.
          }
        }
      }
    }

    setErrors(newErrors);
    if (hasError) {
      toast.error('Please fill in all required fields', {
        duration: Number.POSITIVE_INFINITY,
      });
      return;
    }

    setSaving(section);
    try {
      const payload = { ...data.config };

      if (section === 'embedding') {
        if (form.embeddingProvider !== undefined)
          payload.embeddingProvider = form.embeddingProvider;
        if (form.embeddingModelId !== undefined) payload.embeddingModelId = form.embeddingModelId;
        if (form.embeddingApiKey !== undefined) payload.embeddingApiKey = form.embeddingApiKey;
        if (form.customEmbeddings !== undefined) payload.customEmbeddings = form.customEmbeddings;
      } else if (section === 'chat') {
        if (form.chatProvider !== undefined) payload.chatProvider = form.chatProvider;
        if (form.chatModelId !== undefined) payload.chatModelId = form.chatModelId;
        if (form.chatApiKey !== undefined) payload.chatApiKey = form.chatApiKey;
        if (form.customChatModels !== undefined) payload.customChatModels = form.customChatModels;
      } else if (section === 'vision') {
        if (form.visionProvider !== undefined) payload.visionProvider = form.visionProvider;
        if (form.visionModelId !== undefined) payload.visionModelId = form.visionModelId;
        if (form.visionApiKey !== undefined) payload.visionApiKey = form.visionApiKey;
        if (form.customVisionModels !== undefined)
          payload.customVisionModels = form.customVisionModels;
      } else if (section.startsWith('tool:')) {
        payload.toolConfigs = form.toolConfigs;
      }

      const verifyPayload: any = {};
      if (section === 'embedding') {
        verifyPayload.embeddingProvider = payload.embeddingProvider;
        verifyPayload.embeddingApiKey = payload.embeddingApiKey;
        verifyPayload.embeddingModelId = payload.embeddingModelId;
        verifyPayload.customEmbeddings = payload.customEmbeddings;
      } else if (section === 'chat') {
        verifyPayload.chatProvider = payload.chatProvider;
        verifyPayload.chatApiKey = payload.chatApiKey;
        verifyPayload.chatModelId = payload.chatModelId;
        verifyPayload.customChatModels = payload.customChatModels;
      } else if (section === 'vision') {
        // Vision API compatibility is checked from the catalog on save. A
        // frame request is deliberately not sent just to save preferences.
      } else if (section.startsWith('tool:')) {
        // Skip verification for arbitrary tool configs right now
        // We'll trust the payload
      }

      if (section !== 'vision' && !section.startsWith('tool:')) {
        const verifyRes = await fetch('/api/config/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(verifyPayload),
        });

        if (!verifyRes.ok) {
          const err = await verifyRes.json();
          throw new Error(err.error || 'Verification failed');
        }
      }

      const res = await fetch(configUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save');

      setForm((prev) => ({ ...prev, ...json.config }));
      await mutate(json, { revalidate: false });
      toast.success('AI model settings saved', {
        duration: Number.POSITIVE_INFINITY,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save', {
        duration: Number.POSITIVE_INFINITY,
      });
    } finally {
      setSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">AI Models</h2>
          <p className="text-sm text-muted-foreground">
            Configure the AI models that power your knowledge base.
          </p>
        </div>
      </div>

      <ProjectFormDialog
        mode="create"
        open={newServerModalOpen}
        onOpenChange={setNewServerModalOpen}
      />
      <CustomModelModal
        type="embedding"
        open={customEmbeddingModalOpen}
        onOpenChange={setCustomEmbeddingModalOpen}
        onSave={(cfg) => {
          const modelId = `custom:${cfg.modelName}`;
          if (!canUseEmbeddingModel(modelId, cfg.dimensions)) return;
          setForm({
            ...form,
            embeddingProvider: 'custom',
            embeddingModelId: modelId,
            customEmbeddings: [cfg],
          });
          clearError('embeddingProvider');
        }}
      />
      <CustomModelModal
        type="chat"
        open={customChatModalOpen}
        onOpenChange={setCustomChatModalOpen}
        onSave={(cfg) => {
          setForm({
            ...form,
            chatProvider: 'custom',
            chatModelId: `custom:${cfg.modelName}`,
            customChatModels: [cfg],
          });
          clearError('chatProvider');
        }}
      />
      <CustomModelModal
        type="vision"
        open={customVisionModalOpen}
        onOpenChange={setCustomVisionModalOpen}
        onSave={(cfg) => {
          setForm({
            ...form,
            visionProvider: 'custom',
            visionModelId: `custom:${cfg.modelName}`,
            customVisionModels: [cfg],
          });
          clearError('visionProvider');
        }}
      />

      {/* Embedding Provider */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-3.5 text-primary" />
            Embedding Model
          </CardTitle>
          <CardDescription className="text-xs">
            Transforms your documents into searchable representations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Provider</Label>
            <div className="flex gap-2">
              <Select
                value={form.embeddingProvider ?? 'openai'}
                onValueChange={(v: any) => {
                  setForm({
                    ...form,
                    embeddingProvider: v,
                    embeddingModelId: '',
                  });
                  clearError('embeddingProvider');
                }}
              >
                <SelectTrigger
                  className={cn('w-full', errors.embeddingProvider && 'border-destructive')}
                >
                  <span className="flex items-center gap-2">
                    {PROVIDER_META[
                      (form.embeddingProvider ?? 'openai') as keyof typeof PROVIDER_META
                    ] ? (
                      <>
                        <ProviderIcon
                          src={
                            PROVIDER_META[form.embeddingProvider as keyof typeof PROVIDER_META]
                              ?.iconSrc ?? ''
                          }
                          alt={
                            PROVIDER_META[form.embeddingProvider as keyof typeof PROVIDER_META]
                              ?.label ?? ''
                          }
                          pillBg={
                            PROVIDER_META[form.embeddingProvider as keyof typeof PROVIDER_META]
                              ?.pillBg ?? undefined
                          }
                          size={16}
                        />
                        {PROVIDER_META[form.embeddingProvider as keyof typeof PROVIDER_META]
                          ?.label ?? form.embeddingProvider}
                      </>
                    ) : (
                      form.embeddingProvider || 'Select provider'
                    )}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {EMBEDDING_PROVIDER_LIST.filter(
                    (key) =>
                      (EMBEDDING_BY_PROVIDER[key] && EMBEDDING_BY_PROVIDER[key].length > 0) ||
                      key === 'vercel_ai_gateway',
                  ).map((key) => {
                    const meta = PROVIDER_META[key as keyof typeof PROVIDER_META];
                    if (!meta) return null;
                    return (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <ProviderIcon
                            src={meta.iconSrc}
                            alt={meta.label}
                            pillBg={meta.pillBg ?? undefined}
                            size={16}
                          />
                          <span>
                            {meta.label}
                            {key === 'vercel_ai_gateway' && ' (Recommended)'}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                  {form.customEmbeddings?.map((cfg) => (
                    <SelectItem key={`custom:${cfg.modelName}`} value="custom">
                      <div className="flex items-center gap-2">
                        <ProviderIcon
                          src={PROVIDER_META.custom.iconSrc}
                          alt="Custom"
                          pillBg={PROVIDER_META.custom.pillBg}
                          size={16}
                        />
                        <span>{cfg.modelName} (Custom)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={() => {
                  setCustomEmbeddingModalOpen(true);
                }}
                className="shrink-0 size-10 bg-background"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <ModelCombobox
              value={form.embeddingModelId || ''}
              onValueChange={(v) => {
                if (!canUseEmbeddingModel(v)) return;
                setForm({ ...form, embeddingModelId: v });
                clearError('embeddingModelId');
              }}
              groups={Object.fromEntries(
                Object.entries(EMBEDDING_BY_PROVIDER).filter(
                  ([provider]) =>
                    form.embeddingProvider === 'vercel_ai_gateway' ||
                    provider === form.embeddingProvider ||
                    provider === 'deepseek',
                ),
              )}
              customModels={form.customEmbeddings}
              isOther={isOtherEmbedding}
              onOtherChange={(val) => setIsOtherEmbedding(val)}
              placeholder="Default"
            />
            {isOtherEmbedding && (
              <Input
                placeholder="Enter custom model ID"
                value={form.embeddingModelId || ''}
                onChange={(e) => setForm({ ...form, embeddingModelId: e.target.value })}
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input
                type={showEmbeddingKey ? 'text' : 'password'}
                value={form.embeddingApiKey || ''}
                onChange={(e) => {
                  setForm({
                    ...form,
                    embeddingApiKey: e.target.value,
                  });
                  clearError('embeddingApiKey');
                }}
                placeholder="sk-..."
                className={cn('pr-10', errors.embeddingApiKey && 'border-destructive')}
              />
              <button
                type="button"
                onClick={() => setShowEmbeddingKey(!showEmbeddingKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                {showEmbeddingKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="lg"
            disabled={saving === 'embedding' || !dirtyEmbedding}
            onClick={() => handleSave('embedding')}
            className="gap-1.5 px-4"
          >
            {saving === 'embedding' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Vision-language model — shared by image and media tools. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScanEye className="size-3.5 text-primary" />
            Vision Model
          </CardTitle>
          <CardDescription className="text-xs">
            Used by video, image, OCR, and future tools that need to understand pixels. Only
            providers with vision-capable models are shown.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Provider</Label>
            <div className="flex gap-2">
              <Select
                value={form.visionProvider || ''}
                onValueChange={(value: string | null) => {
                  if (!value) return;
                  setForm({ ...form, visionProvider: value, visionModelId: '' });
                  clearError('visionProvider');
                }}
              >
                <SelectTrigger
                  className={cn('w-full', errors.visionProvider && 'border-destructive')}
                >
                  <span className="flex items-center gap-2">
                    {(() => {
                      const provider = form.visionProvider || '';
                      const meta = PROVIDER_META[provider as keyof typeof PROVIDER_META];
                      return meta ? (
                        <>
                          <ProviderIcon
                            src={meta.iconSrc}
                            alt={meta.label}
                            pillBg={meta.pillBg}
                            size={16}
                          />
                          {meta.label}
                        </>
                      ) : (
                        provider || 'Select a vision provider'
                      );
                    })()}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {visionProviders.map((provider) => {
                    const meta = PROVIDER_META[provider as keyof typeof PROVIDER_META];
                    if (!meta) return null;
                    return (
                      <SelectItem key={provider} value={provider}>
                        <div className="flex items-center gap-2">
                          <ProviderIcon
                            src={meta.iconSrc}
                            alt={meta.label}
                            pillBg={meta.pillBg}
                            size={16}
                          />
                          <span>{meta.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                  {form.customVisionModels?.map((cfg) => (
                    <SelectItem key={`custom:${cfg.modelName}`} value="custom">
                      <div className="flex items-center gap-2">
                        <ProviderIcon
                          src={PROVIDER_META.custom.iconSrc}
                          alt="Custom"
                          pillBg={PROVIDER_META.custom.pillBg}
                          size={16}
                        />
                        <span>{cfg.modelName} (Custom)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={() => {
                  setCustomVisionModalOpen(true);
                }}
                className="shrink-0 size-10 bg-background"
              >
                <Plus className="size-4" />
              </Button>
            </div>
            {!visionProviders.includes(form.visionProvider || '') ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                This provider has no compatible vision model. Choose a provider from the list for
                video and image tasks.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <ModelCombobox
              value={form.visionModelId || 'default'}
              onValueChange={(v) => {
                setForm({ ...form, visionModelId: v === 'default' ? '' : v });
              }}
              items={[
                { id: 'default', label: 'Default vision model' },
                ...visionModels.filter(
                  (model) =>
                    form.visionProvider === 'vercel_ai_gateway' ||
                    model.provider === form.visionProvider,
                ),
              ]}
              customModels={form.customVisionModels}
              isOther={isOtherVision}
              onOtherChange={(val) => setIsOtherVision(val)}
              placeholder="Default vision model"
            />
            {isOtherVision && (
              <Input
                placeholder="Enter custom model ID"
                value={form.visionModelId || ''}
                onChange={(e) => setForm({ ...form, visionModelId: e.target.value })}
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input
                type={showVisionKey ? 'text' : 'password'}
                value={form.visionApiKey || ''}
                onChange={(event) => {
                  setForm({ ...form, visionApiKey: event.target.value });
                  clearError('visionApiKey');
                }}
                placeholder="sk-..."
                className={cn('pr-10', errors.visionApiKey && 'border-destructive')}
              />
              <button
                type="button"
                onClick={() => setShowVisionKey(!showVisionKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                {showVisionKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end border-t pt-4">
          <Button
            size="lg"
            disabled={saving === 'vision' || !dirtyVision}
            onClick={() => handleSave('vision')}
            className="gap-1.5 px-4"
          >
            {saving === 'vision' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>

      {/* Chat (LLM) Provider */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <MessageCircle className="size-3.5 text-primary" />
            Chat Model
          </CardTitle>
          <CardDescription className="text-xs">
            Powers the AI assistant that answers questions from your knowledge base. Leave blank to
            use the same provider as embedding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Provider</Label>
            <div className="flex gap-2">
              <Select
                value={form.chatProvider || form.embeddingProvider || 'openai'}
                onValueChange={(v: any) => {
                  setForm({ ...form, chatProvider: v, chatModelId: '' });
                  clearError('chatProvider');
                }}
              >
                <SelectTrigger
                  className={cn('w-full', errors.chatProvider && 'border-destructive')}
                >
                  <span className="flex items-center gap-2">
                    {(() => {
                      const pKey = form.chatProvider || form.embeddingProvider || 'openai';
                      const meta = PROVIDER_META[pKey as keyof typeof PROVIDER_META];
                      return meta ? (
                        <>
                          <ProviderIcon
                            src={meta.iconSrc}
                            alt={meta.label}
                            pillBg={meta.pillBg ?? undefined}
                            size={16}
                          />
                          {meta.label}
                        </>
                      ) : (
                        pKey
                      );
                    })()}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {CHAT_PROVIDER_LIST.map((key) => {
                    const meta = PROVIDER_META[key as keyof typeof PROVIDER_META];
                    if (!meta) return null;
                    return (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <ProviderIcon
                            src={meta.iconSrc}
                            alt={meta.label}
                            pillBg={meta.pillBg}
                            size={16}
                          />
                          <span>{meta.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                  {form.customChatModels?.map((cfg) => (
                    <SelectItem key={`custom:${cfg.modelName}`} value="custom">
                      <div className="flex items-center gap-2">
                        <ProviderIcon
                          src={PROVIDER_META.custom.iconSrc}
                          alt="Custom"
                          pillBg={PROVIDER_META.custom.pillBg}
                          size={16}
                        />
                        <span>{cfg.modelName} (Custom)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={() => setCustomChatModalOpen(true)}
                className="shrink-0 h-9 w-9"
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <ModelCombobox
              value={form.chatModelId || ''}
              onValueChange={(v) => {
                setForm({ ...form, chatModelId: v });
              }}
              items={chatStatus?.availableModels || []}
              customModels={form.customChatModels}
              isOther={isOtherChat}
              onOtherChange={setIsOtherChat}
              placeholder="Default"
            />
            {isOtherChat && (
              <Input
                placeholder="Enter custom model ID"
                value={form.chatModelId || ''}
                onChange={(e) => setForm({ ...form, chatModelId: e.target.value })}
                className="mt-2"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input
                type={showChatKey ? 'text' : 'password'}
                value={form.chatApiKey || ''}
                onChange={(e) => {
                  setForm({ ...form, chatApiKey: e.target.value });
                  clearError('chatApiKey');
                }}
                placeholder="sk-..."
                className={cn('pr-10', errors.chatApiKey && 'border-destructive')}
              />
              <button
                type="button"
                onClick={() => setShowChatKey(!showChatKey)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
              >
                {showChatKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-4 border-t">
          <Button
            size="lg"
            disabled={saving === 'chat' || !dirtyChat}
            onClick={() => handleSave('chat')}
            className="gap-1.5 px-4"
          >
            {saving === 'chat' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
