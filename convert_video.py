from moviepy.editor import VideoFileClip

input_file = "/Users/v_guohongfei01/Downloads/grainient-1781250872556.webm"
output_file = "/Users/v_guohongfei01/Downloads/grainient-1781250872556.mp4"

print(f"Converting {input_file} to {output_file}")

clip = VideoFileClip(input_file)
clip.write_videofile(output_file, codec="libx264")

print("Conversion completed!")