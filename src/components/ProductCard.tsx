import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Heart, Star, ShoppingCart, Eye, Sparkles } from 'lucide-react';
import { Product } from '../types';
import { handleImageError, getProductPrimaryImage } from '../utils/imageUtils';

interface ProductCardProps {
  product: Product;
  isWishlisted: boolean;
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: Product) => void;
  onQuickView: (product: Product) => void;
  onSelectProduct: (productId: string) => void;
  key?: any;
  variants?: any;
}

export default function ProductCard({
  product,
  isWishlisted,
  onToggleWishlist,
  onAddToCart,
  onQuickView,
  onSelectProduct,
  variants
}: ProductCardProps) {
  const [hovered, setHovered] = useState(false);

  // Derive stock badges
  let stockDotColor = 'bg-emerald-400';
  let stockLabel = 'In Stock';
  if (product.stock === 0) {
    stockDotColor = 'bg-red-400';
    stockLabel = 'Out Of Stock';
  } else if (product.stock <= 5) {
    stockDotColor = 'bg-amber-400';
    stockLabel = 'Low Stock';
  }

  // Derive discount percent
  const discountPercent = product.discountPrice
    ? Math.round(((product.price - product.discountPrice) / product.price) * 100)
    : 0;

  return (
    <motion.div
      {...(!variants ? {
        initial: { opacity: 0, y: 15 },
        animate: { opacity: 1, y: 0 }
      } : {})}
      variants={variants}
      whileHover={{ y: -6 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="bg-white dark:bg-navy-900 rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] border border-gray-100 dark:border-navy-800 hover:border-gold-400/50 flex flex-col h-full group transition-all duration-300 relative select-none text-slate-800 dark:text-slate-200"
    >
      {/* Product Image Stage */}
      <div
        onClick={() => onSelectProduct(product.id)}
        className="relative pt-[100%] overflow-hidden bg-gray-50 cursor-pointer"
      >
        <img
          src={getProductPrimaryImage(product)}
          alt={product.name}
          referrerPolicy="no-referrer"
          onError={(e) => handleImageError(e, product.category)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
        />

        {/* Absolute Badges Layer — on the image, reference-style */}
        <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1.5 items-start">
          {product.isNew && (
            <span className="px-2 py-0.5 rounded-md bg-navy-900/90 border border-gold-400/20 text-white text-[9px] font-mono tracking-wider uppercase font-semibold flex items-center gap-1 backdrop-blur-sm">
              <Sparkles className="w-2.5 h-2.5 text-gold-400" /> New
            </span>
          )}
          {discountPercent > 0 && (
            <span className="px-2 py-0.5 rounded-md bg-gradient-to-r from-gold-500 to-gold-400 text-navy-950 text-[10px] font-bold font-sans tracking-wide">
              -{discountPercent}% OFF
            </span>
          )}
          {product.stock === 0 && (
            <span className="px-2 py-0.5 rounded-md bg-red-500 text-white text-[9px] font-mono tracking-wider uppercase font-semibold">
              Sold Out
            </span>
          )}
        </div>

        {/* Floating Wishlist Heart Trigger — on the image, reference-style */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleWishlist(product.id);
          }}
          className="absolute top-2.5 right-2.5 z-10 p-2 rounded-full bg-white/85 hover:bg-white shadow-sm text-gray-500 hover:text-red-500 transition-all cursor-pointer focus:outline-none backdrop-blur-sm"
          title={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
        >
          <Heart className={`w-4 h-4 ${isWishlisted ? 'fill-red-500 text-red-500 scale-110' : 'transition-transform hover:scale-110'}`} />
        </button>

        {/* Hover quick views layout (desktop only — touch devices use the Add button) */}
        {hovered && product.stock > 0 && (
          <div className="absolute inset-0 bg-navy-950/20 backdrop-blur-[2px] transition hidden sm:flex items-center justify-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); onQuickView(product); }}
              className="p-3 bg-white hover:bg-gold-50 rounded-full border border-gray-100 shadow-xl text-gray-700 hover:text-gold-500 active:scale-95 transition cursor-pointer"
              title="Quick View Details"
            >
              <Eye className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAddToCart(product); }}
              className="p-3 bg-gradient-to-r from-gold-500 to-gold-400 text-navy-950 rounded-full shadow-lg hover:from-gold-600 active:scale-95 transition cursor-pointer"
              title="Add To Cart"
            >
              <ShoppingCart className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Card Information metadata */}
      <div className="p-3 sm:p-4 flex-1 flex flex-col justify-between space-y-2.5 sm:space-y-3">
        <div className="space-y-1 sm:space-y-1.5 text-left">
          {/* Category Tag */}
          <span className="text-[10px] font-mono uppercase tracking-wider text-gold-500 font-medium">
            {product.category}
          </span>

          <h4
            onClick={() => onSelectProduct(product.id)}
            className="font-display font-medium text-xs sm:text-sm text-navy-900 dark:text-navy-50 group-hover:text-gold-500 transition cursor-pointer line-clamp-2 leading-snug"
          >
            {product.name}
          </h4>

          <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1 sm:line-clamp-2 font-sans font-light leading-relaxed">
            {product.shortDescription}
          </p>
        </div>

        {/* Rating star feedback and stocks label — one row, reference-style */}
        <div className="flex items-center justify-between gap-1.5">
          {/* Star displays */}
          <div className="flex items-center gap-1">
            <div className="flex items-center text-amber-400">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            </div>
            <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 font-sans">{product.rating.toFixed(1)}</span>
            <span className="text-[9px] text-gray-400 font-sans font-light">({product.ratingCount})</span>
          </div>

          {/* stock state feedback */}
          <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${stockDotColor}`} />
            <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 tracking-wide">{stockLabel}</span>
          </div>
        </div>

        {/* Price row */}
        <div className="flex items-baseline gap-2">
          {product.discountPrice ? (
            <>
              <span className="text-base sm:text-sm font-bold text-navy-900 dark:text-white font-sans leading-none">
                Rs.{product.discountPrice}
              </span>
              <span className="text-[10px] line-through text-gray-400 font-mono">
                Rs.{product.price}
              </span>
            </>
          ) : (
            <span className="text-base sm:text-sm font-bold text-navy-900 dark:text-white font-sans">
              Rs.{product.price}
            </span>
          )}
        </div>

        {/* Full-width Add to Bag — reference-style CTA */}
        <button
          onClick={() => onAddToCart(product)}
          disabled={product.stock === 0}
          className={`w-full py-2 bg-navy-900 dark:bg-navy-800 hover:bg-gold-500 hover:text-navy-950 hover:shadow-lg hover:shadow-gold-500/30 text-white rounded-xl text-xs font-medium tracking-wide flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all duration-200 cursor-pointer shadow-md select-none border border-navy-800 dark:border-navy-700 hover:border-gold-500 disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          <span>{product.stock === 0 ? 'Sold Out' : 'Add to Bag'}</span>
        </button>
      </div>
    </motion.div>
  );
}
