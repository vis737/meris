import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Timer, ShoppingBag, Zap, AlertCircle, RefreshCw } from 'lucide-react';
import { Product } from '../types';
import { handleImageError } from '../utils/imageUtils';

interface FlashSaleSectionProps {
  products: Product[];
  onAddProductToCart: (product: Product) => void;
  onSelectProduct: (productId: string) => void;
}

function formatTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    hours: hours.toString().padStart(2, '0'),
    minutes: minutes.toString().padStart(2, '0'),
    seconds: seconds.toString().padStart(2, '0'),
  };
}

export default function FlashSaleSection({ products, onAddProductToCart, onSelectProduct }: FlashSaleSectionProps) {
  const [timeLeft, setTimeLeft] = useState(8070);
  const [activeProducts, setActiveProducts] = useState<Product[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem('meris_flash_sale_end');
    const now = Math.floor(Date.now() / 1000);
    let targetEnd = now + 8070;

    if (stored) {
      const parsed = parseInt(stored);
      if (parsed > now) {
        targetEnd = parsed;
      } else {
        sessionStorage.setItem('meris_flash_sale_end', targetEnd.toString());
      }
    } else {
      sessionStorage.setItem('meris_flash_sale_end', targetEnd.toString());
    }

    setTimeLeft(targetEnd - now);

    const timer = setInterval(() => {
      const secondsLeft = targetEnd - Math.floor(Date.now() / 1000);
      if (secondsLeft <= 0) {
        setTimeLeft(0);
        clearInterval(timer);
      } else {
        setTimeLeft(secondsLeft);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (products.length === 0) return;

    const list = products.filter(
      p => p.id === 'bag-1' || p.id === 'wood-1' || p.id === 'toy-2'
    );

    if (list.length === 0) {
      setActiveProducts(products.slice(0, 3));
    } else {
      setActiveProducts(list);
    }
  }, [products]);

  const { hours, minutes, seconds } = formatTime(timeLeft);

  if (timeLeft <= 0) return null;

  return (
    <section className="bg-gradient-to-tr from-[#0F172A] to-slate-900 border border-gold-300/30 rounded-3xl p-6 md:p-8 text-left relative overflow-hidden select-none font-sans max-w-7xl mx-auto my-12">
      <div className="absolute right-0 top-0 translate-y-[-20%] translate-x-[20%] w-96 h-96 bg-gold-400/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 pb-6 border-b border-slate-800 relative z-10">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-mono font-bold tracking-widest uppercase">
            <Zap className="w-3.5 h-3.5 fill-rose-500 text-rose-500 animate-bounce" />
            Today's Workshop Deals
          </div>
          <h3 className="font-display font-black text-white text-xl sm:text-2xl uppercase tracking-wider">
            A Few Pieces Left At 30% Off
          </h3>
          <p className="text-xs text-slate-450 dark:text-gray-400 max-w-lg leading-relaxed">
            We found a small batch of extra stock in the workshop — so a few favourites are{' '}
            <span className="text-gold-400 font-bold">30% off</span> until the timer runs out.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-slate-950/65 border border-slate-800 p-4 rounded-2xl max-w-sm">
          <Timer className="w-5 h-5 text-gold-400 shrink-0" />
          <div className="space-y-1">
            <span className="text-[9px] font-mono tracking-widest uppercase text-slate-400 font-bold block">Expiring In</span>
            <div className="flex gap-1.5 font-mono text-lg font-black text-white">
              <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded-lg text-gold-400">{hours}</span>
              <span className="text-gold-400 animate-pulse">:</span>
              <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded-lg text-gold-400">{minutes}</span>
              <span className="text-gold-400 animate-pulse">:</span>
              <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded-lg text-gold-400">{seconds}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6 pt-6">
        {activeProducts.map(product => {
          const flashPrice = Math.round(product.price * 0.7);

          return (
            <div
              key={product.id}
              className="group p-3 md:p-4 bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800 hover:border-gold-500/40 rounded-2xl transition duration-300 flex flex-col text-left cursor-pointer"
              onClick={() => onSelectProduct(product.id)}
            >
              <div className="relative pt-[100%] rounded-xl overflow-hidden bg-slate-950 shrink-0 border border-slate-800">
                <img
                  src={product.images && product.images[0] ? product.images[0] : ''}
                  alt={product.name}
                  referrerPolicy="no-referrer"
                  onError={(e) => handleImageError(e, product.category)}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <span className="absolute top-1.5 left-1.5 bg-rose-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-[0.5px]">
                  -{30}%
                </span>
              </div>

              <div className="flex-1 flex flex-col justify-between pt-2.5">
                <div>
                  <span className="text-[8px] font-mono text-gold-500 uppercase font-black block">{product.category}</span>
                  <h4 className="font-display font-bold text-[11px] md:text-xs text-white line-clamp-2 mt-0.5 group-hover:text-gold-300 transition leading-snug">
                    {product.name}
                  </h4>
                  <p className="hidden md:block text-[10px] text-slate-400 font-light line-clamp-1 mt-0.5">{product.shortDescription}</p>
                </div>

                <div className="mt-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm md:text-xs font-bold text-white font-mono">Rs.{flashPrice}</span>
                    <span className="text-[10px] text-slate-500 line-through font-mono">Rs.{product.price}</span>
                  </div>

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      const copy: Product = { ...product, discountPrice: flashPrice };
                      onAddProductToCart(copy);
                    }}
                    className="mt-2 w-full p-1.5 rounded-lg bg-amber-500 text-navy-950 hover:bg-amber-600 text-[10px] font-display font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
                  >
                    <ShoppingBag className="w-3 h-3 text-navy-950" />
                    <span>Buy now</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {activeProducts.length === 0 && (
        <div className="text-center py-8 text-slate-400">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-60" />
          <p className="text-xs font-mono">No sale items in stock right now — check back soon for fresh drops.</p>
        </div>
      )}
    </section>
  );
}
