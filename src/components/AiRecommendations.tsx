import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, PlusCircle, TrendingUp, UserCheck } from 'lucide-react';
import { CartItem, Product } from '../types';
import { getAIRecommendations } from '../utils/aiRecommender';
import ProductCard from './ProductCard';

interface AiRecommendationsProps {
  cartItems: CartItem[];
  recentlyViewedIds: string[];
  allProducts: Product[];
  onSelectProduct: (productId: string) => void;
}

const STATIC_RECS: Product[] = [
  { id: 'stat-1', sku: 'stat-1', name: 'Crystalline Rosewood Journal', description: 'Hand-foliaged, archival pages bound in rosewood.', price: 499, discountPrice: 349, stock: 12, category: 'Wood Crafted Gifts', categorySlug: 'wood-crafts', images: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop'], shortDescription: 'A keepsake that outlasts memories.', rating: 4.8, ratingCount: 34, weightKg: 0.4, availability: 'in-stock', isNew: false, isBestseller: true, brand: 'MERIS', reviews: [], specifications: {}, toyParameters: {} },
  { id: 'kolam-1', sku: 'kolam-1', name: 'Laser-Cut Kolam Stencil Set', description: 'Precision acrylic stencils for festival floors.', price: 249, discountPrice: 199, stock: 20, category: 'Kolam Stencils', categorySlug: 'kolam', images: ['https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=600&auto=format&fit=crop'], shortDescription: 'Endless geometric patterns, ready to trace.', rating: 4.7, ratingCount: 21, weightKg: 0.2, availability: 'in-stock', isNew: true, isBestseller: false, brand: 'MERIS', reviews: [], specifications: {}, toyParameters: {} },
  { id: 'wood-1', sku: 'wood-1', name: 'Hand-Carved Rosewood Keepsake Box', description: 'Hand-carved from a single rosewood block.', price: 1299, discountPrice: 999, stock: 6, category: 'Wood Crafted Gifts', categorySlug: 'wood-crafts', images: ['https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&auto=format&fit=crop'], shortDescription: 'A treasure box worthy of treasures.', rating: 4.9, ratingCount: 41, weightKg: 0.8, availability: 'in-stock', isNew: false, isBestseller: true, brand: 'MERIS', reviews: [], specifications: {}, toyParameters: {} },
];

const FALLBACK_COMMENTARY =
  'Our virtual concierge is gently polishing the shelves. In the meantime, here are a few handpicked emails from the workshop.';

export default function AiRecommendations({
  cartItems,
  recentlyViewedIds,
  allProducts,
  onSelectProduct,
}: AiRecommendationsProps) {
  const [recommendations, setRecommendations] = React.useState<{
    conciergeCommentary: string;
    recommendedProductIds: string[];
  } | null>(null);
  const [loading, setLoading] = React.useState(false);

  const cartToken = JSON.stringify(cartItems.map(item => ({ id: item.product.id, qty: item.quantity })));
  const viewedToken = recentlyViewedIds.join(',');
  const productsCount = allProducts.length;

  React.useEffect(() => {
    if (productsCount === 0) return;

    const fetchAiRecs = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/gemini/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cartItems,
            recentlyViewedIds,
            allProducts: allProducts.map(p => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
              price: p.price,
              category: p.category,
            })),
          }),
        });

        if (response.ok) {
          const data = await response.json();
          setRecommendations(data);
        }
      } catch {
        // Network failure -> keep existing recommendations or fall back silently
      } finally {
        setLoading(false);
      }
    };

    fetchAiRecs();
  }, [cartToken, viewedToken, productsCount]);

  const recommendedProducts = React.useMemo(() => {
    if (!recommendations?.recommendedProductIds) return [];
    return allProducts.filter(p => recommendations.recommendedProductIds.includes(p.id)).slice(0, 3);
  }, [recommendations, allProducts]);

  if (loading) {
    return (
      <div className="bg-navy-900 border border-gold-400/20 rounded-2xl p-6 text-white text-center space-y-3 shadow-xl max-w-full">
        <div className="flex items-center justify-center gap-2 text-gold-400">
          <Sparkles className="w-5 h-5 animate-spin" />
          <span className="font-display font-medium tracking-wide text-xs uppercase">Picking for you...</span>
        </div>
        <p className="text-xs text-navy-200 font-mono animate-pulse">Mending your shelf with care...</p>
      </div>
    );
  }

  const usable = recommendedProducts.length > 0 ? recommendedProducts : STATIC_RECS.filter(p => (p.stock ?? 0) > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-navy-900 via-navy-950 to-black text-white border border-gold-400/30 rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-gold-400/10 via-transparent to-transparent opacity-60 pointer-events-none" />

      <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between relative z-10">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-gold-400 font-display font-medium text-xs tracking-widest uppercase">
            <UserCheck className="w-4 h-4 text-gold-400" />
            PICKED FOR YOU
          </div>
          <p className="text-sm font-sans italic text-gold-100/90 leading-relaxed font-light">
            {recommendations?.conciergeCommentary || FALLBACK_COMMENTARY}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full lg:w-auto">
          {usable.map((product) => (
            <div
              key={product.id}
              onClick={() => onSelectProduct(product.id)}
              className="bg-navy-800/80 hover:bg-navy-800 border border-gold-400/20 hover:border-gold-400/50 rounded-xl p-3 flex flex-row sm:flex-col items-center gap-3 cursor-pointer transition-all duration-300 group scale-95 hover:scale-100"
            >
              <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-white/5 shrink-0">
                <img
                  src={getPrimaryImage(product)}
                  alt={product.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-110 transition duration-300"
                />
              </div>
              <div className="text-left sm:text-center flex-1 min-w-0">
                <h5 className="font-display font-medium text-xs text-gold-200 line-clamp-1 group-hover:text-gold-400 transition truncate">
                  {product.name}
                </h5>
                <p className="font-mono text-[10px] text-navy-200 mt-0.5 truncate">{product.category}</p>
                <div className="flex items-center sm:justify-center gap-2 mt-1">
                  <span className="text-xs font-semibold text-gold-400 font-sans">
                    Rs.{product.discountPrice || product.price}
                  </span>
                  {product.discountPrice && (
                    <span className="text-[10px] line-through text-navy-300">Rs.{product.price}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function getPrimaryImage(product: { images?: string[]; category?: string }): string {
  if (product?.images && Array.isArray(product.images) && product.images.length > 0) {
    const first = product.images[0];
    if (typeof first === 'string' && first.trim().length > 0) {
      return first.trim();
    }
  }
  return 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=120&auto=format&fit=crop&q=60';
}
