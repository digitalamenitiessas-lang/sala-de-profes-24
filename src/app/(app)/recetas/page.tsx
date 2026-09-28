'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  ChefHat,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { logAuditClient } from '@/lib/audit'
import { createClient } from '@/lib/supabase/client'
import { RECIPE_CATEGORY_OPTIONS } from '@/lib/constants'
import type { RecipeCategory } from '@/lib/constants'
import type { Recipe, LegacyRecipeIngredient as RecipeIngredient, RecipeInsert } from '@/types/database'

import { RecipeCard } from '@/components/recipes/RecipeCard'
import { RecipeDetailDialog } from '@/components/recipes/RecipeDetailDialog'
import { RecipeFormDialog } from '@/components/recipes/RecipeFormDialog'
import { RecipeDeleteDialog } from '@/components/recipes/RecipeDeleteDialog'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type FilterTab = 'todas' | RecipeCategory

// La columna fudo_synced_at puede no existir todavía en la base (migración
// pendiente): se tipa opcional y el fetch usa select('*'), que trae la columna
// sólo si existe — sin romper la página en bases sin migrar.
type RecipeRow = Recipe & { fudo_synced_at?: string | null }

const EMPTY_INGREDIENT: RecipeIngredient = { name: '', qty: '', unit: 'g' }

// ---------------------------------------------------------------------------
// Recipes Page
// ---------------------------------------------------------------------------

export default function RecetasPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [supabase] = useState(() => createClient())

  // Data
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [activeTab, setActiveTab] = useState<FilterTab>('todas')
  const [searchQuery, setSearchQuery] = useState('')

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [saving, setSaving] = useState(false)

  // Detail dialog
  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null)

  // Aviso "esta receta se edita en Fudo"
  const [fudoNoticeRecipe, setFudoNoticeRecipe] = useState<RecipeRow | null>(null)

  // Delete
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingRecipe, setDeletingRecipe] = useState<Recipe | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState<RecipeCategory>('bebidas')
  const [formIngredients, setFormIngredients] = useState<RecipeIngredient[]>([
    { ...EMPTY_INGREDIENT },
  ])
  const [formPreparation, setFormPreparation] = useState('')
  const [formNotes, setFormNotes] = useState('')

  const isChef = profile?.role === 'chef' || profile?.role === 'socio'
  const canView =
    profile?.role === 'socio' ||
    profile?.role === 'chef' ||
    profile?.role === 'encargado' ||
    profile?.role === 'cocina'

  // ------------------------------------------
  // Fetch recipes
  // ------------------------------------------
  const fetchRecipes = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (error) throw error
      setRecipes((data as RecipeRow[]) ?? [])
    } catch (err) {
      console.error('Error al cargar recetas:', err)
      toast.error('Error al cargar las recetas')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    if (canView) fetchRecipes()
  }, [canView, fetchRecipes])

  // ------------------------------------------
  // Filtered recipes
  // ------------------------------------------
  const filteredRecipes = useMemo(() => {
    let result = recipes
    if (activeTab !== 'todas') {
      result = result.filter((r) => r.category === activeTab)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((r) => r.name.toLowerCase().includes(q))
    }
    return result
  }, [recipes, activeTab, searchQuery])

  // ------------------------------------------
  // Dialog helpers
  // ------------------------------------------
  function resetForm() {
    setFormName('')
    setFormCategory('bebidas')
    setFormIngredients([{ ...EMPTY_INGREDIENT }])
    setFormPreparation('')
    setFormNotes('')
  }

  function openCreateDialog() {
    setEditingRecipe(null)
    resetForm()
    setDialogOpen(true)
  }

  function openEditDialog(recipe: Recipe) {
    // Las recetas espejo de Fudo NO se editan acá: se editan en Fudo y se
    // reimporta el export (evita divergencia silenciosa con la próxima import).
    const synced = (recipe as RecipeRow).fudo_synced_at
    if (synced) {
      setFudoNoticeRecipe(recipe as RecipeRow)
      return
    }
    setEditingRecipe(recipe)
    setFormName(recipe.name)
    setFormCategory(recipe.category as RecipeCategory)
    setFormIngredients(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((i) => ({ ...i }))
        : [{ ...EMPTY_INGREDIENT }],
    )
    setFormPreparation(recipe.preparation)
    setFormNotes(recipe.notes ?? '')
    setDialogOpen(true)
  }

  // ------------------------------------------
  // Ingredients management
  // ------------------------------------------
  function addIngredient() {
    setFormIngredients((prev) => [...prev, { ...EMPTY_INGREDIENT }])
  }

  function removeIngredient(index: number) {
    setFormIngredients((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  function updateIngredient(
    index: number,
    field: keyof RecipeIngredient,
    value: string,
  ) {
    setFormIngredients((prev) =>
      prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing)),
    )
  }

  // ------------------------------------------
  // Save (create/update)
  // ------------------------------------------
  async function handleSave() {
    if (!profile) return
    if (!formName.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }

    const cleanIngredients = formIngredients.filter(
      (i) => i.name.trim() !== '',
    )

    setSaving(true)
    try {
      if (editingRecipe) {
        const { error } = await supabase
          .from('recipes')
          .update({
            name: formName.trim(),
            category: formCategory,
            ingredients: cleanIngredients,
            preparation: formPreparation.trim(),
            notes: formNotes.trim() || null,
          })
          .eq('id', editingRecipe.id)

        if (error) throw error
        logAuditClient({
          userId: profile?.id ?? null,
          userName: profile?.first_name ?? null,
          action: 'update_recipe',
          module: 'recetas',
          entityType: 'recipe',
          entityId: String(editingRecipe.id),
          description: `${profile?.first_name ?? 'User'} editó receta: ${formName.trim()}`,
        })
        toast.success('Receta actualizada')
      } else {
        const insertData: RecipeInsert = {
          name: formName.trim(),
          category: formCategory,
          ingredients: cleanIngredients,
          preparation: formPreparation.trim(),
          notes: formNotes.trim() || null,
          created_by: profile.id,
        }

        const { error } = await supabase.from('recipes').insert(insertData)
        if (error) throw error
        logAuditClient({
          userId: profile?.id ?? null,
          userName: profile?.first_name ?? null,
          action: 'create_recipe',
          module: 'recetas',
          entityType: 'recipe',
          description: `${profile?.first_name ?? 'User'} creó receta: ${formName.trim()}`,
        })
        toast.success('Receta creada')
      }

      setDialogOpen(false)
      await fetchRecipes()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al guardar la receta'
      toast.error('Error', { description: message })
    } finally {
      setSaving(false)
    }
  }

  // ------------------------------------------
  // Delete (soft delete)
  // ------------------------------------------
  function openDeleteDialog(recipe: Recipe) {
    setDeletingRecipe(recipe)
    setDeleteDialogOpen(true)
  }

  async function handleDelete() {
    if (!deletingRecipe) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('recipes')
        .update({ is_active: false })
        .eq('id', deletingRecipe.id)

      if (error) throw error
      logAuditClient({
        userId: profile?.id ?? null,
        userName: profile?.first_name ?? null,
        action: 'delete_recipe',
        module: 'recetas',
        entityType: 'recipe',
        entityId: String(deletingRecipe.id),
        description: `${profile?.first_name ?? 'User'} desactivó receta: ${deletingRecipe.name}`,
      })
      toast.success('Receta eliminada')
      setDeleteDialogOpen(false)
      setDeletingRecipe(null)
      await fetchRecipes()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al eliminar'
      toast.error('Error', { description: message })
    } finally {
      setDeleting(false)
    }
  }

  // ------------------------------------------
  // Loading / Permission states
  // ------------------------------------------
  if (profileLoading) return <LoadingState />

  if (!profile || !canView) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Sin permisos"
        description="No tienes acceso al recetario."
      />
    )
  }

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-28">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">
          Recetario
        </h1>
        <p className="section-label mt-2">Recetas y preparaciones</p>
      </div>

      {/* Category pill tabs */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab('todas')}
          className={`pill ${activeTab === 'todas' ? 'pill-active' : 'pill-inactive'}`}
        >
          Todas
        </button>
        {RECIPE_CATEGORY_OPTIONS.map((cat) => (
          <button
            key={cat.value}
            type="button"
            onClick={() => setActiveTab(cat.value)}
            className={`pill ${activeTab === cat.value ? 'pill-active' : 'pill-inactive'}`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        <Input
          placeholder="Buscar receta..."
          className="rounded-xl border-[#ebe6df] bg-[#faf8f5] pl-10"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Content */}
      {loading ? (
        <LoadingState message="Cargando recetas..." />
      ) : filteredRecipes.length === 0 ? (
        <EmptyState
          icon={ChefHat}
          title="Sin recetas"
          description={
            isChef
              ? 'Agrega tu primera receta para comenzar.'
              : 'Aun no hay recetas cargadas.'
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              fudoSynced={Boolean(recipe.fudo_synced_at)}
              isChef={isChef}
              onClick={() => setDetailRecipe(recipe)}
              onEdit={() => openEditDialog(recipe)}
              onDelete={() => openDeleteDialog(recipe)}
            />
          ))}
        </div>
      )}

      {/* FAB: Create Recipe (chef only) */}
      {isChef && (
        <button
          onClick={openCreateDialog}
          className="fab"
          aria-label="Nueva receta"
        >
          <Plus className="size-6" />
        </button>
      )}

      {/* Dialogs */}
      <RecipeDetailDialog
        recipe={detailRecipe}
        fudoSynced={Boolean((detailRecipe as RecipeRow | null)?.fudo_synced_at)}
        isChef={isChef}
        onClose={() => setDetailRecipe(null)}
        onEdit={openEditDialog}
        onDelete={openDeleteDialog}
      />

      {/* Aviso: receta espejo de Fudo, no editable en la app */}
      <Dialog
        open={!!fudoNoticeRecipe}
        onOpenChange={(open) => !open && setFudoNoticeRecipe(null)}
      >
        <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#e6f4f0]">
                <RefreshCw className="size-5 text-[#006d5a]" />
              </div>
              <div>
                <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
                  Sincronizada de Fudo
                </DialogTitle>
                <DialogDescription className="text-sm text-[#a39e97]">
                  {fudoNoticeRecipe?.name}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-[#3d2c24]">
            Esta receta se edita en Fudo. Cambiala allá y reimportá el export
            (Más → Fudo → Importar recetas).
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-[#ebe6df] text-[#3d2c24]"
              onClick={() => setFudoNoticeRecipe(null)}
            >
              Entendido
            </Button>
            {profile?.role === 'socio' && (
              <Link
                href="/admin/fudo/importar"
                className="inline-flex h-9 items-center justify-center rounded-xl bg-[#006d5a] px-4 text-sm font-medium text-white transition-colors hover:bg-[#00594a]"
              >
                <ExternalLink className="mr-1.5 size-3.5" />
                Importar recetas
              </Link>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecipeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        isEditing={!!editingRecipe}
        saving={saving}
        formName={formName}
        setFormName={setFormName}
        formCategory={formCategory}
        setFormCategory={setFormCategory}
        formIngredients={formIngredients}
        formPreparation={formPreparation}
        setFormPreparation={setFormPreparation}
        formNotes={formNotes}
        setFormNotes={setFormNotes}
        onAddIngredient={addIngredient}
        onRemoveIngredient={removeIngredient}
        onUpdateIngredient={updateIngredient}
        onSave={handleSave}
      />

      <RecipeDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        recipeName={deletingRecipe?.name ?? ''}
        deleting={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}
