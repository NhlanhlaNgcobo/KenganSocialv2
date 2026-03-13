import ffmpeg from 'fluent-ffmpeg';

const cmd = ffmpeg('dummy.mp4').input('dummy.mp4');
cmd.complexFilter([
    { filter: 'crop', options: 'ih*9/16:ih', inputs: '0:v', outputs: 'v1' },
    { filter: 'scale', options: '1080:1920', inputs: 'v1', outputs: 'v2' },
    { filter: 'volume', options: '1', inputs: '0:a', outputs: 'a0' },
    { filter: 'volume', options: '0.2', inputs: '1:a', outputs: 'a1' },
    { filter: 'amix', options: 'inputs=2:duration=first', inputs: ['a0', 'a1'], outputs: 'afinal' }
], ['v2', 'afinal']);
cmd.outputOptions(['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']);

cmd.on('error', (err) => console.log('ERROR:', err.message));
cmd.on('end', () => console.log('SUCCESS'));
cmd.on('start', console.log);
cmd.save('test_out2.mp4');
