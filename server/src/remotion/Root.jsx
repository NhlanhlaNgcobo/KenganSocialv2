import { Composition, AbsoluteFill, OffthreadVideo, useVideoConfig } from 'remotion';

/**
 * VerticalCrop Composition
 * Takes an input video and crops it to 9:16 vertical format
 * for mobile-first platforms like TikTok, Reels, Shorts.
 */
export const VerticalCropVideo = ({ src }) => {
    const { width, height } = useVideoConfig();

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            <OffthreadVideo
                src={src}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center center',
                }}
            />
        </AbsoluteFill>
    );
};

/**
 * CaptionedVideo Composition
 * Same as VerticalCrop but with caption overlay.
 */
export const CaptionedVideo = ({ src, captions, style }) => {
    const { width, height, fps } = useVideoConfig();

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            <OffthreadVideo
                src={src}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                }}
            />
            {/* Caption overlay would be rendered per-frame here */}
        </AbsoluteFill>
    );
};

/**
 * Root component that registers all compositions.
 */
export const RemotionRoot = () => {
    return (
        <>
            <Composition
                id="VerticalCrop"
                component={VerticalCropVideo}
                durationInFrames={30 * 60} // placeholder, overridden at render time
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{ src: '' }}
            />
            <Composition
                id="CaptionedVideo"
                component={CaptionedVideo}
                durationInFrames={30 * 60}
                fps={30}
                width={1080}
                height={1920}
                defaultProps={{ src: '', captions: [], style: {} }}
            />
        </>
    );
};
