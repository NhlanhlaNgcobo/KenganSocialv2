import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, Img, interpolate } from 'remotion';
import React from 'react';

export const ProductShowcase: React.FC<{
    productImage: string;
    productName: string;
    price: string;
    ctaText: string;
    brandColor: string;
}> = ({ productImage, productName, price, ctaText, brandColor = '#10b981' }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    // Animations
    const zoomScale = interpolate(frame, [0, 150], [1.2, 1], { extrapolateRight: 'clamp' });
    const textSlide = spring({ fps, frame: frame - 15, from: -100, to: 0, config: { damping: 15 } });
    const ctaSlide = spring({ fps, frame: frame - (fps * 2), from: 200, to: 0, config: { damping: 12 } }); // 2 seconds delay

    return (
        <AbsoluteFill style={{ backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' }}>

            {/* Product Image Zoom */}
            {productImage && (
                <Img
                    src={productImage}
                    style={{
                        width: '60%',
                        height: '60%',
                        objectFit: 'contain',
                        transform: `scale(${zoomScale})`,
                        filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.6))'
                    }}
                />
            )}

            {/* Info Header */}
            <div style={{
                position: 'absolute', top: '100px', width: '100%',
                textAlign: 'center', transform: `translateY(${textSlide}px)`
            }}>
                <h1 style={{ fontFamily: 'sans-serif', fontSize: '80px', color: 'white', margin: 0, fontWeight: 800 }}>
                    {productName}
                </h1>
                <h2 style={{ fontFamily: 'sans-serif', fontSize: '60px', color: brandColor, margin: '10px 0 0 0', fontWeight: 600 }}>
                    {price}
                </h2>
            </div>

            {/* CTA Button */}
            <div style={{
                position: 'absolute', bottom: '150px',
                transform: `translateY(${ctaSlide}px)`,
                background: brandColor,
                padding: '24px 64px',
                borderRadius: '100px',
                boxShadow: `0 10px 30px ${brandColor}66`
            }}>
                <span style={{ fontFamily: 'sans-serif', fontSize: '50px', fontWeight: 800, color: 'white', textTransform: 'uppercase' }}>
                    {ctaText}
                </span>
            </div>

        </AbsoluteFill>
    );
};
