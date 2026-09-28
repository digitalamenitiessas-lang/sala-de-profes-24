'use client'

import { Pencil, RefreshCw, Trash2, CookingPot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { RECIPE_CATEGORIES } from '@/lib/constants'
import type { RecipeCategory } from '@/lib/constants'
import type { Recipe } from '@/types/database'

type RecipeDetailDialogProps = {
  recipe: Recipe | null
  /** Receta espejo del export de Fudo (se edita en Fudo, no en la app). */
  fudoSynced?: boolean
  isChef: boolean
  onClose: () => void
  onEdit: (recipe: Recipe) => void
  onDelete: (recipe: Recipe) => void
}

export function RecipeDetailDialog({
  recipe,
  fudoSynced = false,
  isChef,
  onClose,
  onEdit,
  onDelete,
}: RecipeDetailDialogProps) {
  if (!recipe) return null

  const catConfig =
    RECIPE_CATEGORIES[recipe.category as RecipeCategory] ??
    RECIPE_CATEGORIES.bebidas

  return (
    <Dialog open={!!recipe} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className="flex size-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: catConfig.bg }}
            >
              <CookingPot className="size-5" style={{ color: catConfig.color }} />
            </div>
            <div>
              <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
                {recipe.name}
              </DialogTitle>
              <DialogDescription>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: catConfig.bg,
                    color: catConfig.color,
                  }}
                >
                  {catConfig.icon} {catConfig.label}
                </span>
                {fudoSynced && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-[#e6f4f0] px-2 py-0.5 text-xs font-medium text-[#006d5a]">
                    <RefreshCw className="size-3" />
                    Sincronizada de Fudo
                  </span>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Ingredients */}
          {recipe.ingredients.length > 0 && (
            <div>
              <h4 className="section-label mb-2.5">Ingredientes</h4>
              <div className="space-y-1.5">
                {recipe.ingredients.map((ing, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-sm text-[#3d2c24]"
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-[#006d5a]" />
                    <span>
                      {ing.qty && (
                        <span className="font-semibold tabular-nums">
                          {ing.qty}
                          {ing.unit !== 'a_gusto' ? ing.unit : ''}{' '}
                        </span>
                      )}
                      {ing.unit === 'a_gusto' && (
                        <span className="font-semibold">a gusto </span>
                      )}
                      {ing.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preparation */}
          {recipe.preparation && (
            <div>
              <h4 className="section-label mb-2.5">Preparacion</h4>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#3d2c24]">
                {recipe.preparation}
              </p>
            </div>
          )}

          {/* Notes */}
          {recipe.notes && (
            <div>
              <h4 className="section-label mb-2.5">Notas</h4>
              <p className="text-sm italic text-[#a39e97]">{recipe.notes}</p>
            </div>
          )}
        </div>

        {/* Chef actions */}
        {isChef && (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="rounded-xl border-[#ebe6df] text-[#3d2c24]"
              onClick={() => {
                onClose()
                onEdit(recipe)
              }}
            >
              <Pencil className="mr-1.5 size-3.5" />
              Editar
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl bg-[#ea504c] hover:bg-[#d4413e]"
              onClick={() => {
                onClose()
                onDelete(recipe)
              }}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Eliminar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
