'use client'

import { useState } from 'react'
import { Search, ChefHat } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RECIPE_CATEGORIES } from '@/lib/constants'
import type { RecipeCategory } from '@/lib/constants'
import type { Recipe } from '@/types/database'
import { groupBy } from '@/lib/utils/group-by'

type AddFromRecipeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipes: Recipe[]
  onSelect: (recipe: Recipe) => void
}

export function AddFromRecipeDialog({
  open,
  onOpenChange,
  recipes,
  onSelect,
}: AddFromRecipeDialogProps) {
  const [search, setSearch] = useState('')

  // Clear search when dialog closes
  function handleOpenChange(open: boolean) {
    if (!open) setSearch('')
    onOpenChange(open)
  }

  const filtered = recipes.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  )

  const grouped = groupBy(filtered, 'category')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#3d2c24]">
            <ChefHat className="size-5 text-[#d4943a]" />
            Agregar desde receta
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
          <input
            type="text"
            placeholder="Buscar receta..."
            aria-label="Buscar receta"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] pl-10 pr-4 text-sm text-[#3d2c24] outline-none placeholder:text-[#c4bfb8] focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]/20"
          />
        </div>

        {/* Recipe list */}
        <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
          {Object.entries(grouped).map(([cat, catRecipes]) => {
            const catConfig =
              RECIPE_CATEGORIES[cat as RecipeCategory] ?? RECIPE_CATEGORIES.bebidas
            return (
              <div key={cat}>
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#a39e97]">
                  {catConfig.icon} {catConfig.label}
                </span>
                <div className="space-y-1.5">
                  {catRecipes.map((recipe) => (
                    <button
                      key={recipe.id}
                      onClick={() => {
                        onSelect(recipe)
                        setSearch('')
                      }}
                      className="flex w-full items-start gap-3 rounded-xl border border-[#ebe6df] bg-[#fefcf9] p-3 text-left transition-all hover:border-[#006d5a]/30 hover:bg-[#e8f5f1]/40"
                    >
                      <div
                        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-sm"
                        style={{ backgroundColor: catConfig.bg, color: catConfig.color }}
                      >
                        {catConfig.icon}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-semibold text-[#3d2c24]">
                          {recipe.name}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {recipe.ingredients.slice(0, 4).map((ing, i) => (
                            <span
                              key={i}
                              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-[#a39e97]"
                            >
                              {ing.qty}{ing.unit} {ing.name}
                            </span>
                          ))}
                          {recipe.ingredients.length > 4 && (
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-[#a39e97]">
                              +{recipe.ingredients.length - 4}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-[#a39e97]">
              No se encontraron recetas
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
