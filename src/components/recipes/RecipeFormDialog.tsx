'use client'

import { Plus, X, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { RECIPE_CATEGORY_OPTIONS, RECIPE_UNITS } from '@/lib/constants'
import type { RecipeCategory } from '@/lib/constants'
import type { LegacyRecipeIngredient as RecipeIngredient } from '@/types/database'

type RecipeFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  isEditing: boolean
  saving: boolean
  // Form state
  formName: string
  setFormName: (v: string) => void
  formCategory: RecipeCategory
  setFormCategory: (v: RecipeCategory) => void
  formIngredients: RecipeIngredient[]
  formPreparation: string
  setFormPreparation: (v: string) => void
  formNotes: string
  setFormNotes: (v: string) => void
  // Ingredient handlers
  onAddIngredient: () => void
  onRemoveIngredient: (index: number) => void
  onUpdateIngredient: (index: number, field: keyof RecipeIngredient, value: string) => void
  onSave: () => void
}

export function RecipeFormDialog({
  open,
  onOpenChange,
  isEditing,
  saving,
  formName,
  setFormName,
  formCategory,
  setFormCategory,
  formIngredients,
  formPreparation,
  setFormPreparation,
  formNotes,
  setFormNotes,
  onAddIngredient,
  onRemoveIngredient,
  onUpdateIngredient,
  onSave,
}: RecipeFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
            {isEditing ? 'Editar Receta' : 'Nueva Receta'}
          </DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            {isEditing
              ? 'Modifica los datos de la receta.'
              : 'Completa los datos para crear una nueva receta.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#3d2c24]">Nombre</Label>
            <Input
              placeholder="Nombre de la receta"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5]"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#3d2c24]">Categoria</Label>
            <Select
              value={formCategory}
              onValueChange={(v) => v && setFormCategory(v as RecipeCategory)}
            >
              <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]">
                <SelectValue placeholder="Seleccionar categoria" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#ebe6df]">
                {RECIPE_CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Ingredients */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#3d2c24]">Ingredientes</Label>
            <div className="space-y-2">
              {formIngredients.map((ing, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <Input
                    placeholder="Ingrediente"
                    className="flex-1 rounded-xl border-[#ebe6df] bg-[#faf8f5] text-sm"
                    value={ing.name}
                    onChange={(e) => onUpdateIngredient(index, 'name', e.target.value)}
                  />
                  <Input
                    placeholder="Cant"
                    className="w-16 rounded-xl border-[#ebe6df] bg-[#faf8f5] text-center text-sm"
                    value={ing.qty}
                    onChange={(e) => onUpdateIngredient(index, 'qty', e.target.value)}
                  />
                  <Select
                    value={ing.unit}
                    onValueChange={(v) => v && onUpdateIngredient(index, 'unit', v)}
                  >
                    <SelectTrigger className="w-20 rounded-xl border-[#ebe6df] bg-[#faf8f5] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-[#ebe6df]">
                      {RECIPE_UNITS.map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => onRemoveIngredient(index)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#a39e97] transition-colors hover:bg-[#fef2f2] hover:text-[#ea504c]"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onAddIngredient}
              className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-[#ebe6df] px-3 py-2 text-xs font-medium text-[#a39e97] transition-colors hover:border-[#006d5a]/30 hover:text-[#006d5a]"
            >
              <Plus className="size-3.5" />
              Agregar ingrediente
            </button>
          </div>

          {/* Preparation */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#3d2c24]">Preparacion</Label>
            <Textarea
              placeholder="Describe los pasos de preparacion..."
              className="min-h-[6rem] rounded-xl border-[#ebe6df] bg-[#faf8f5]"
              value={formPreparation}
              onChange={(e) => setFormPreparation(e.target.value)}
              rows={4}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[#3d2c24]">Notas (opcional)</Label>
            <Textarea
              placeholder="Tips, variantes, alergenos..."
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5]"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose
            render={
              <Button
                variant="outline"
                className="rounded-xl border-[#ebe6df] text-[#3d2c24]"
              />
            }
          >
            Cancelar
          </DialogClose>
          <Button
            onClick={onSave}
            disabled={saving}
            className="rounded-xl bg-[#006d5a] text-white hover:bg-[#005a4a]"
          >
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {isEditing ? 'Guardar cambios' : 'Crear receta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
