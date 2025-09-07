# Hunt for Secrets

A client-side treasure hunt around Barcelona. Solve clues by visiting famous landmarks and uploading photos with GPS metadata. If the photo was taken near the expected location, you earn a point.

## Running

Just open `index.html` in a browser. No server is required.

## How it works

The page lists a set of locations. For each clue, upload a photo. The browser reads the image's GPS EXIF data and checks whether it was taken within 100 meters of the target location. Your score updates as you solve clues.
