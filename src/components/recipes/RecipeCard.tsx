import { Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { RECIPE_CATEGORIES } from '@/lib/constants'
import type { RecipeCategory } from '@/lib/constants'
import type { Recipe } from '@/types/database'

type RecipeCardProps = {
  recipe: Recipe
  /** Receta espejo del export de Fudo (se edita en Fudo, no en la app). */
  fudoSynced?: boolean
  isChef: boolean
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
}

export function RecipeCard({
  recipe,
  fudoSynced = false,
  isChef,
  onClick,
  onEdit,
  onDelete,
}: RecipeCardProps) {
  const catConfig =
    RECIPE_CATEGORIES[recipe.category as RecipeCategory] ??
    RECIPE_CATEGORIES.bebidas

  return (
    <div
      className="card-elevated hover-lift group relative cursor-pointer overflow-hidden rounded-xl"
      onClick={onClick}
    >
      <div className="flex">
        {/* Accent bar */}
        <div
          className="w-1 shrink-0"
          style={{ backgroundColor: catConfig.color }}
        />
        <div className="flex-1 p-4">
          {/* Top row: name + category badge */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#3d2c24]">
              {recipe.name}
            </h3>
            <span
              className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: catConfig.bg,
                color: catConfig.color,
              }}
            >
              {catConfig.icon} {catConfig.label}
            </span>
          </div>

          {/* Badge: espejo de Fudo */}
          {fudoSynced && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#e6f4f0] px-2 py-0.5 text-[10px] font-semibold text-[#006d5a]">
              <RefreshCw className="size-2.5" />
              Sincronizada de Fudo
            </span>
          )}

          {/* Ingredients preview */}
          {recipe.ingredients.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recipe.ingredients.slice(0, 3).map((ing, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[11px] text-[#3d2c24]"
                >
                  {ing.qty && `${ing.qty}${ing.unit} `}
                  {ing.name}
                </span>
              ))}
              {recipe.ingredients.length > 3 && (
                <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[11px] text-[#a39e97]">
                  +{recipe.ingredients.length - 3} mas
                </span>
              )}
            </div>
          )}

          {/* Preparation preview */}
          {recipe.preparation && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#a39e97]">
              {recipe.preparation}
            </p>
          )}
        </div>
      </div>

      {/* Edit / Delete buttons (chef only) */}
      {isChef && (
        <div className="absolute right-2.5 top-2.5 hidden gap-1.5 group-hover:flex">
          <button
            className="flex size-7 items-center justify-center rounded-lg border border-[#ebe6df] bg-[#fefcf9]/95 shadow-sm backdrop-blur-sm transition-colors hover:bg-[#f3efe9]"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          >
            <Pencil className="size-3 text-[#a39e97]" />
          </button>
          <button
            className="flex size-7 items-center justify-center rounded-lg border border-[#ebe6df] bg-[#fefcf9]/95 shadow-sm backdrop-blur-sm transition-colors hover:bg-[#fef2f2]"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="size-3 text-[#ea504c]" />
          </button>
        </div>
      )}
    </div>
  )
}
