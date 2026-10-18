import importlib.util,pathlib,unittest
import numpy as np
from PIL import Image
spec=importlib.util.spec_from_file_location('background',pathlib.Path(__file__).resolve().parent.parent/'assets/inpaint_background.py')
background=importlib.util.module_from_spec(spec);spec.loader.exec_module(background)
class BackgroundTest(unittest.TestCase):
 def test_old_and_new_pose_are_replaced_but_background_and_unmasked_pixels_are_exact(self):
  source=Image.new('RGB',(120,100),'red');candidate=Image.new('RGB',source.size,'blue')
  old=np.zeros((100,120),dtype=np.uint8);old[35:65,40:55]=255
  new=np.zeros_like(old);new[35:65,65:80]=255
  mask=np.zeros_like(old);mask[20:80,20:100]=255
  result,details=background.composite(source,candidate,Image.fromarray(mask),Image.fromarray(old),Image.fromarray(new),0)
  pixels=np.asarray(result)
  self.assertTrue(np.all(pixels[40:60,40:55]==[0,0,255]))
  self.assertTrue(np.all(pixels[40:60,65:80]==[0,0,255]))
  self.assertTrue(np.all(pixels[:20]==[255,0,0]))
  self.assertTrue(np.all(pixels[20:80,20:23]==[255,0,0]))
  self.assertEqual(details['protectedChangedPixels'],0);self.assertGreater(details['protectedPixels'],6000)
 def test_empty_subject_does_not_silently_return_unchanged_image(self):
  rgb=Image.new('RGB',(32,32));empty=Image.new('L',rgb.size)
  with self.assertRaisesRegex(ValueError,'未识别'):background.composite(rgb,rgb,Image.new('L',rgb.size,255),empty,empty)
if __name__=='__main__':unittest.main()
